"""Genera embeddings e ingiere documentos y fragmentos en Neo4j."""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path
from typing import Any

from common import PROJECT_DIR, append_jsonl, batched, load_env, openrouter_post, read_jsonl, require_env, safe_error


MODEL = "nvidia/nemotron-3-embed-1b:free"


def embeddings(texts: list[str], api_key: str, model: str) -> list[list[float]]:
    data = openrouter_post("embeddings", {"model": model, "input": texts}, api_key)
    try:
        ordered = sorted(data["data"], key=lambda item: item["index"])
        vectors = [item["embedding"] for item in ordered]
    except (KeyError, TypeError) as exc:
        raise RuntimeError("Respuesta de embeddings con formato inesperado") from exc
    if len(vectors) != len(texts) or any(not vector for vector in vectors):
        raise RuntimeError("OpenRouter devolvió una cantidad inválida de embeddings")
    return vectors


def setup_schema(session: Any, dimensions: int) -> None:
    statements = [
        "CREATE CONSTRAINT documento_numero IF NOT EXISTS FOR (d:Documento) REQUIRE d.numero IS UNIQUE",
        "CREATE CONSTRAINT fragmento_id IF NOT EXISTS FOR (f:Fragmento) REQUIRE f.id IS UNIQUE",
        "CREATE FULLTEXT INDEX fragmentos_texto IF NOT EXISTS FOR (f:Fragmento) ON EACH [f.texto, f.titulo]",
        f"CREATE VECTOR INDEX fragmentos_vector IF NOT EXISTS FOR (f:Fragmento) ON (f.embedding) OPTIONS {{indexConfig: {{`vector.dimensions`: {dimensions}, `vector.similarity_function`: 'cosine'}}}}",
    ]
    for statement in statements:
        session.run(statement).consume()


def write_batch(tx: Any, rows: list[dict[str, Any]], model: str) -> None:
    tx.run(
        """
        UNWIND $rows AS row
        MERGE (d:Documento {numero: row.numero})
        SET d.proyecto = row.proyecto, d.titulo = row.titulo, d.fecha = row.fecha,
            d.estado = row.estado, d.autores = row.autores, d.fuente = row.fuente
        MERGE (f:Fragmento {id: row.id})
        SET f.indice = row.indice, f.texto = row.texto, f.titulo = row.titulo,
            f.numero = row.numero, f.paginas = row.paginas, f.metodo = row.metodo, f.fuente = row.fuente,
            f.embedding = row.embedding, f.modelo_embedding = $model
        MERGE (d)-[:TIENE_FRAGMENTO]->(f)
        """,
        rows=rows,
        model=model,
    ).consume()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingiere chunks y embeddings en Neo4j de forma reanudable.")
    parser.add_argument("--entrada", type=Path, default=PROJECT_DIR / "processed" / "chunks.jsonl")
    parser.add_argument("--checkpoint", type=Path, default=PROJECT_DIR / "processed" / "ingest.checkpoint.jsonl")
    parser.add_argument("--env", type=Path, default=PROJECT_DIR / ".env.local")
    parser.add_argument("--modelo", default=MODEL)
    parser.add_argument("--lote", type=int, default=16)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    driver = None
    try:
        try:
            from neo4j import GraphDatabase
        except ImportError as exc:
            raise RuntimeError("Falta la dependencia 'neo4j'; instale requirements.txt") from exc
        if args.lote < 1:
            raise ValueError("El lote debe ser mayor que cero")
        load_env(args.env)
        api_key, uri, user, password = require_env("OPENROUTER_API_KEY", "NEO4J_URI", "NEO4J_USER", "NEO4J_PASS")
        database = os.environ.get("NEO4J_DATABASE", "neo4j")
        completed = {row["id"] for row in read_jsonl(args.checkpoint.resolve())}
        pending = [row for row in read_jsonl(args.entrada.resolve()) if row["id"] not in completed]
        if not pending:
            print("No hay fragmentos pendientes; la ingesta ya está completa.")
            return 0
        driver = GraphDatabase.driver(uri, auth=(user, password))
        driver.verify_connectivity()
        schema_ready = False
        processed = 0
        with driver.session(database=database) as session:
            for batch in batched(pending, args.lote):
                vectors = embeddings([row["texto"] for row in batch], api_key, args.modelo)
                if not schema_ready:
                    setup_schema(session, len(vectors[0]))
                    schema_ready = True
                enriched = []
                for row, vector in zip(batch, vectors, strict=True):
                    item = dict(row)
                    item["embedding"] = vector
                    enriched.append(item)
                session.execute_write(write_batch, enriched, args.modelo)
                for row in batch:
                    append_jsonl(args.checkpoint.resolve(), {"id": row["id"], "huella": hashlib.sha256(row["texto"].encode()).hexdigest()})
                processed += len(batch)
                print(f"Ingeridos {processed}/{len(pending)} fragmentos.")
        print("Ingesta completada correctamente.")
        return 0
    except (OSError, KeyError, ValueError, RuntimeError) as exc:
        print(f"Error: {safe_error(exc)}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Error de Neo4j o red: {type(exc).__name__}: {safe_error(exc)}", file=sys.stderr)
        return 1
    finally:
        if driver is not None:
            driver.close()


if __name__ == "__main__":
    raise SystemExit(main())
