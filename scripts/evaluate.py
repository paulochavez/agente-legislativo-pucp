"""Ejecuta consultas de sanidad sobre el grafo ingerido."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from common import PROJECT_DIR, load_env, require_env, safe_error


CHECKS = {
    "conteos": "MATCH (d:Documento) WITH count(d) AS documentos MATCH (f:Fragmento) RETURN documentos, count(f) AS fragmentos",
    "huerfanos": "MATCH (f:Fragmento) WHERE NOT (:Documento)-[:TIENE_FRAGMENTO]->(f) RETURN count(f) AS fragmentos_huerfanos",
    "documentos_sin_fragmentos": "MATCH (d:Documento) WHERE NOT (d)-[:TIENE_FRAGMENTO]->(:Fragmento) RETURN count(d) AS documentos_sin_fragmentos",
    "embeddings_faltantes": "MATCH (f:Fragmento) WHERE f.embedding IS NULL OR size(f.embedding) = 0 RETURN count(f) AS embeddings_faltantes",
    "dimensiones": "MATCH (f:Fragmento) WHERE f.embedding IS NOT NULL RETURN size(f.embedding) AS dimension, count(*) AS cantidad ORDER BY cantidad DESC",
    "duplicados": "MATCH (d:Documento) WITH d.numero AS numero, count(*) AS cantidad WHERE cantidad > 1 RETURN numero, cantidad ORDER BY cantidad DESC LIMIT 20",
    "muestra": "MATCH (d:Documento)-[:TIENE_FRAGMENTO]->(f:Fragmento) RETURN d.numero AS numero, d.titulo AS titulo, f.indice AS fragmento, f.paginas AS paginas, left(f.texto, 160) AS texto ORDER BY numero, fragmento LIMIT 5",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ejecuta consultas de sanity sin modificar Neo4j.")
    parser.add_argument("--env", type=Path, default=PROJECT_DIR / ".env.local")
    parser.add_argument("--json", action="store_true", help="Emite los resultados como JSON")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    driver = None
    try:
        try:
            from neo4j import GraphDatabase
        except ImportError as exc:
            raise RuntimeError("Falta la dependencia 'neo4j'; instale requirements.txt") from exc
        load_env(args.env)
        uri, user, password = require_env("NEO4J_URI", "NEO4J_USER", "NEO4J_PASS")
        driver = GraphDatabase.driver(uri, auth=(user, password))
        driver.verify_connectivity()
        output = {}
        with driver.session(database=os.environ.get("NEO4J_DATABASE", "neo4j")) as session:
            for name, query in CHECKS.items():
                output[name] = [record.data() for record in session.run(query)]
        if args.json:
            print(json.dumps(output, ensure_ascii=False, indent=2, default=str))
        else:
            for name, rows in output.items():
                print(f"\n[{name}]")
                print(json.dumps(rows, ensure_ascii=False, indent=2, default=str))
        return 0
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"Error: {safe_error(exc)}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Error de Neo4j: {type(exc).__name__}: {safe_error(exc)}", file=sys.stderr)
        return 1
    finally:
        if driver is not None:
            driver.close()


if __name__ == "__main__":
    raise SystemExit(main())
