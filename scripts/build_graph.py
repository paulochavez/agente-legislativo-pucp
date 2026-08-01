"""Reconstruye el grafo relacional desde el CSV y las portadas de los PDF."""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from pathlib import Path
from typing import Any

import fitz

from common import PROJECT_DIR, WORKSPACE_DIR, batched, load_env, require_env, safe_error


DEFAULT_CORPUS = WORKSPACE_DIR / "ejemplo_clase" / "proyecto_ley"
UPPER_NAME = r"[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ .,'’-]{4,}"


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" ,.;:-")


def cover_people(text: str) -> tuple[tuple[str, str] | None, tuple[str, str] | None]:
    """Devuelve (emisor, destinatario) cuando la primera página es un oficio."""
    recipient_match = re.search(
        rf"\bSeñor(?:a)?\s*\n\s*({UPPER_NAME})\s*\n\s*([^\n]+)", text, re.MULTILINE
    )
    emitter_match = re.search(
        rf"\bAtentamente,?\s*\n\s*({UPPER_NAME})\s*\n\s*([^\n]+)", text, re.MULTILINE
    )
    recipient = (
        (clean(recipient_match.group(1)).title(), clean(recipient_match.group(2)))
        if recipient_match else None
    )
    emitter = (
        (clean(emitter_match.group(1)).title(), clean(emitter_match.group(2)))
        if emitter_match else None
    )
    return emitter, recipient


def load_rows(corpus: Path) -> list[dict[str, Any]]:
    with (corpus / "_indice.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        index = list(csv.DictReader(handle))
    rows: list[dict[str, Any]] = []
    for item in index:
        numero = item["numero"].strip()
        pdf = corpus / f"PL_{numero}.pdf"
        text = ""
        if pdf.exists():
            with fitz.open(pdf) as document:
                if document.page_count:
                    text = document[0].get_text("text")
        emitter, recipient = cover_people(text)
        authors = [clean(author) for author in (item.get("autores") or "").split(";") if clean(author)]
        rows.append({
            "numero": numero,
            "id": f"PL_{numero}",
            "proyecto": item["proyecto"].strip(),
            "titulo": item["titulo"].strip(),
            "fecha": item["fecha"].strip(),
            "estado": item["estado"].strip(),
            "autores": authors,
            "emisor": {"nombre": emitter[0], "cargo": emitter[1]} if emitter else None,
            "destinatario": {"nombre": recipient[0], "cargo": recipient[1]} if recipient else None,
        })
    return rows


def write_batch(tx: Any, rows: list[dict[str, Any]]) -> None:
    tx.run(
        """
        UNWIND $rows AS row
        MERGE (d:Documento {numero: row.numero})
        SET d.id = row.id, d.proyecto = row.proyecto, d.titulo = row.titulo,
            d.fecha = row.fecha, d.estado = row.estado, d.autores = row.autores
        FOREACH (_ IN CASE WHEN row.emisor IS NULL THEN [] ELSE [1] END |
          MERGE (e:Persona {nombre: row.emisor.nombre})
          MERGE (e)-[:EMITE]->(d)
          MERGE (c:Cargo {nombre: row.emisor.cargo})
          MERGE (e)-[:TIENE_EL_CARGO]->(c)
        )
        FOREACH (_ IN CASE WHEN row.destinatario IS NULL THEN [] ELSE [1] END |
          MERGE (r:Persona {nombre: row.destinatario.nombre})
          MERGE (d)-[:DIRIGIDO_A]->(r)
          MERGE (c:Cargo {nombre: row.destinatario.cargo})
          MERGE (r)-[:TIENE_EL_CARGO]->(c)
        )
        FOREACH (author IN CASE WHEN row.emisor IS NULL THEN row.autores ELSE [] END |
          MERGE (a:Persona {nombre: author})
          MERGE (a)-[:EMITE]->(d)
          MERGE (c:Cargo {nombre: 'Autor de proyecto de ley'})
          MERGE (a)-[:TIENE_EL_CARGO]->(c)
        )
        """,
        rows=rows,
    ).consume()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Construye el grafo desde CSV y portadas PDF.")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--env", type=Path, default=PROJECT_DIR / ".env.local")
    parser.add_argument("--lote", type=int, default=100)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    driver = None
    try:
        from neo4j import GraphDatabase

        if args.lote < 1:
            raise ValueError("El lote debe ser mayor que cero")
        load_env(args.env)
        uri, user, password = require_env("NEO4J_URI", "NEO4J_USER", "NEO4J_PASS")
        database = os.environ.get("NEO4J_DATABASE", "neo4j")
        rows = load_rows(args.corpus.resolve())
        driver = GraphDatabase.driver(uri, auth=(user, password))
        driver.verify_connectivity()
        with driver.session(database=database) as session:
            session.run(
                "CREATE CONSTRAINT documento_numero IF NOT EXISTS FOR (d:Documento) REQUIRE d.numero IS UNIQUE"
            ).consume()
            session.run(
                "CREATE INDEX persona_nombre IF NOT EXISTS FOR (p:Persona) ON (p.nombre)"
            ).consume()
            for group in batched(rows, args.lote):
                session.execute_write(write_batch, group)
        office_count = sum(1 for row in rows if row["emisor"])
        print(f"Grafo construido: {len(rows)} documentos; {office_count} oficios con emisor y destinatario.")
        return 0
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"Error: {safe_error(exc)}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Error de Neo4j ({type(exc).__name__}); revise la instancia y sus credenciales.", file=sys.stderr)
        return 1
    finally:
        if driver is not None:
            driver.close()


if __name__ == "__main__":
    raise SystemExit(main())
