"""Extrae, normaliza y fragmenta los proyectos de ley del corpus PDF."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import re
import sys
from pathlib import Path
from typing import Any

import fitz

from common import PROJECT_DIR, WORKSPACE_DIR, append_jsonl, atomic_write_jsonl, load_env, openrouter_post, read_jsonl, require_env, safe_error


DEFAULT_CORPUS = WORKSPACE_DIR / "ejemplo_clase" / "proyecto_ley"
DEFAULT_OUTPUT = PROJECT_DIR / "processed" / "chunks.jsonl"
DEFAULT_CHECKPOINT = PROJECT_DIR / "processed" / "pages.checkpoint.jsonl"


def useful_length(text: str) -> int:
    return len(re.sub(r"[^\wÁÉÍÓÚÜÑáéíóúüñ]", "", text, flags=re.UNICODE))


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00ad", "")
    text = re.sub(r"(?<=\w)-\n(?=\w)", "", text)
    lines = [re.sub(r"[\t ]+", " ", line).strip() for line in text.splitlines()]
    paragraphs: list[str] = []
    current: list[str] = []
    for line in lines:
        if line:
            current.append(line)
        elif current:
            paragraphs.append(" ".join(current))
            current = []
    if current:
        paragraphs.append(" ".join(current))
    return "\n\n".join(paragraphs).strip()


def ocr_page(page: fitz.Page, api_key: str, model: str, dpi: int) -> str:
    pixmap = page.get_pixmap(dpi=dpi, alpha=False)
    image = base64.b64encode(pixmap.tobytes("png")).decode("ascii")
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "Transcribe fielmente esta página. Devuelve solo el texto, sin comentarios ni Markdown."},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image}"}},
            ],
        }],
    }
    data = openrouter_post("chat/completions", payload, api_key)
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("La respuesta OCR no contiene texto") from exc
    if isinstance(content, list):
        content = "\n".join(part.get("text", "") for part in content if isinstance(part, dict))
    return str(content)


def load_index(index_path: Path) -> list[dict[str, str]]:
    with index_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    required = {"numero", "proyecto", "titulo", "fecha", "estado", "autores"}
    if not rows or not required.issubset(rows[0]):
        raise ValueError(f"El índice debe contener las columnas: {', '.join(sorted(required))}")
    return [{key: (value or "").strip() for key, value in row.items()} for row in rows]


def page_records(corpus: Path, rows: list[dict[str, str]], checkpoint: Path, model: str, dpi: int,
                 limit: int | None) -> dict[tuple[str, int], dict[str, Any]]:
    saved = {(str(r["numero"]), int(r["pagina"])): r for r in read_jsonl(checkpoint)}
    selected = rows[:limit] if limit is not None else rows
    api_key: str | None = None
    for position, metadata in enumerate(selected, 1):
        numero = metadata["numero"]
        pdf_path = corpus / f"PL_{numero}.pdf"
        if not pdf_path.exists():
            print(f"Aviso: no existe {pdf_path.name}; se omite.", file=sys.stderr)
            continue
        try:
            with fitz.open(pdf_path) as document:
                if document.needs_pass:
                    raise RuntimeError("el PDF está protegido")
                for page_index, page in enumerate(document):
                    key = (numero, page_index + 1)
                    if key in saved:
                        continue
                    raw = page.get_text("text")
                    method = "texto"
                    if useful_length(raw) < 50:
                        if api_key is None:
                            api_key = require_env("OPENROUTER_API_KEY")[0]
                        raw = ocr_page(page, api_key, model, dpi)
                        method = "ocr"
                    record = {"numero": numero, "pagina": page_index + 1, "texto": normalize(raw), "metodo": method}
                    append_jsonl(checkpoint, record)
                    saved[key] = record
            print(f"Procesado {position}/{len(selected)}: {pdf_path.name}")
        except Exception as exc:
            raise RuntimeError(f"Error al procesar {pdf_path.name}: {exc}") from exc
    return saved


def split_document(metadata: dict[str, str], pages: list[dict[str, Any]], source: str,
                   target: int, overlap: int) -> list[dict[str, Any]]:
    segments: list[tuple[int, int, int, str]] = []
    document_parts: list[str] = []
    cursor = 0
    for page in pages:
        text = page["texto"]
        if not text:
            continue
        separator = "\n\n" if document_parts else ""
        cursor += len(separator)
        document_parts.append(separator + text)
        segments.append((cursor, cursor + len(text), page["pagina"], page["metodo"]))
        cursor += len(text)
    full_text = "".join(document_parts)
    chunks: list[dict[str, Any]] = []
    start = 0
    while start < len(full_text):
        end = min(start + target, len(full_text))
        if end < len(full_text):
            candidates = [full_text.rfind("\n\n", start + target // 2, end), full_text.rfind(". ", start + target // 2, end)]
            boundary = max(candidates)
            if boundary > start:
                end = boundary + (2 if full_text[boundary:boundary + 2] in {"\n\n", ". "} else 0)
        text = full_text[start:end].strip()
        touched = [(page, method) for left, right, page, method in segments if left < end and right > start]
        if text and touched:
            page_numbers = sorted({page for page, _ in touched})
            methods = sorted({method for _, method in touched})
            chunk_index = len(chunks)
            chunk_id = hashlib.sha256(f"{metadata['proyecto']}:{chunk_index}:{text}".encode()).hexdigest()[:32]
            chunks.append({
                "id": chunk_id,
                "numero": metadata["numero"], "proyecto": metadata["proyecto"],
                "titulo": metadata["titulo"], "fecha": metadata["fecha"], "estado": metadata["estado"],
                "autores": [author.strip() for author in metadata["autores"].split(";") if author.strip()],
                "paginas": page_numbers, "fuente": source,
                "metodo": methods[0] if len(methods) == 1 else "mixto",
                "indice": chunk_index, "texto": text,
            })
        if end >= len(full_text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extrae PDFs y genera fragmentos JSONL reanudables.")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--indice", type=Path, help="CSV; por defecto <corpus>/_indice.csv")
    parser.add_argument("--salida", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--env", type=Path, default=PROJECT_DIR / ".env.local")
    parser.add_argument("--modelo-ocr", default="google/gemini-2.5-flash-lite")
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--tamano", type=int, default=3500)
    parser.add_argument("--solapamiento", type=int, default=400)
    parser.add_argument("--limite", type=int)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.tamano < 500 or not 0 <= args.solapamiento < args.tamano:
            raise ValueError("El tamaño debe ser >= 500 y el solapamiento menor que el tamaño")
        load_env(args.env)
        corpus = args.corpus.resolve()
        index_path = (args.indice or corpus / "_indice.csv").resolve()
        if not index_path.is_file():
            raise FileNotFoundError(f"No se encontró el índice: {index_path}")
        rows = load_index(index_path)
        records = page_records(corpus, rows, args.checkpoint.resolve(), args.modelo_ocr, args.dpi, args.limite)
        chunks: list[dict[str, Any]] = []
        selected = rows[:args.limite] if args.limite is not None else rows
        for metadata in selected:
            pages = sorted((r for (number, _), r in records.items() if number == metadata["numero"]), key=lambda r: r["pagina"])
            if pages:
                chunks.extend(split_document(metadata, pages, str(corpus / f"PL_{metadata['numero']}.pdf"), args.tamano, args.solapamiento))
        atomic_write_jsonl(args.salida.resolve(), chunks)
        print(f"Salida generada: {args.salida.resolve()} ({len(chunks)} fragmentos)")
        return 0
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"Error: {safe_error(exc)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
