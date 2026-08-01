"""Copia el subgrafo Documento/Persona/Cargo desde una instancia Neo4j."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from common import PROJECT_DIR, WORKSPACE_DIR, batched, load_env, require_env, safe_error


DEFAULT_CREDENTIALS = WORKSPACE_DIR / "ejemplo_clase" / "Neo4j-764ab99e-Created-2026-07-28.txt"
ALLOWED_LABELS = {"Documento", "Persona", "Cargo"}


def parse_credentials(path: Path) -> tuple[str, str, str, str]:
    values: dict[str, str] = {}
    aliases = {
        "NEO4J_URI": "uri", "URI": "uri", "CONNECTION_URI": "uri",
        "NEO4J_USERNAME": "user", "NEO4J_USER": "user", "USERNAME": "user", "USER": "user",
        "NEO4J_PASSWORD": "password", "NEO4J_PASS": "password", "PASSWORD": "password",
        "NEO4J_DATABASE": "database", "DATABASE": "database",
    }
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z0-9_ ]+)\s*[:,=]\s*(.+)$", line)
        if match:
            key = re.sub(r"\s+", "_", match.group(1).strip()).upper()
            if key in aliases:
                values[aliases[key]] = match.group(2).strip().strip("\"'")
    if not {"uri", "user", "password"}.issubset(values):
        raise ValueError(
            "Formato de credenciales no reconocido. Se esperan URI, USERNAME y PASSWORD en líneas KEY=VALUE, KEY: VALUE o KEY,VALUE."
        )
    return values["uri"], values["user"], values["password"], values.get("database", "neo4j")


def copy_id(label: str, properties: dict[str, Any]) -> str:
    serialized = json.dumps([label, properties], ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode()).hexdigest()


def merge_nodes(tx: Any, rows: list[dict[str, Any]], label: str) -> None:
    tx.run(
        f"UNWIND $rows AS row MERGE (n:`{label}` {{_copy_graph_id: row.copy_id}}) SET n += row.properties",
        rows=rows,
    ).consume()


def merge_relationships(tx: Any, rows: list[dict[str, Any]], relationship_type: str) -> None:
    tx.run(
        f"""UNWIND $rows AS row
        MATCH (a {{_copy_graph_id: row.start_id}}), (b {{_copy_graph_id: row.end_id}})
        MERGE (a)-[r:`{relationship_type}`]->(b) SET r += row.properties""",
        rows=rows,
    ).consume()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Copia Documento, Persona, Cargo y sus relaciones a Neo4j destino.")
    parser.add_argument("--credenciales-origen", type=Path, default=DEFAULT_CREDENTIALS)
    parser.add_argument("--env", type=Path, default=PROJECT_DIR / ".env.local")
    parser.add_argument("--lote", type=int, default=500)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_driver = destination_driver = None
    try:
        try:
            from neo4j import GraphDatabase
        except ImportError as exc:
            raise RuntimeError("Falta la dependencia 'neo4j'; instale requirements.txt") from exc
        if args.lote < 1:
            raise ValueError("El lote debe ser mayor que cero")
        source_uri, source_user, source_password, source_database = parse_credentials(args.credenciales_origen.resolve())
        load_env(args.env)
        destination_uri, destination_user, destination_password = require_env("NEO4J_URI", "NEO4J_USER", "NEO4J_PASS")
        destination_database = os.environ.get("NEO4J_DATABASE", "neo4j")
        source_driver = GraphDatabase.driver(source_uri, auth=(source_user, source_password))
        destination_driver = GraphDatabase.driver(destination_uri, auth=(destination_user, destination_password))
        source_driver.verify_connectivity()
        destination_driver.verify_connectivity()
        node_map: dict[str, str] = {}
        nodes_by_label: dict[str, list[dict[str, Any]]] = {label: [] for label in ALLOWED_LABELS}
        with source_driver.session(database=source_database) as source:
            result = source.run("MATCH (n) WHERE any(label IN labels(n) WHERE label IN $labels) RETURN elementId(n) AS eid, labels(n) AS labels, properties(n) AS properties", labels=sorted(ALLOWED_LABELS))
            for record in result:
                labels = ALLOWED_LABELS.intersection(record["labels"])
                if len(labels) != 1:
                    raise ValueError("Cada nodo copiado debe tener exactamente una etiqueta Documento, Persona o Cargo")
                label = next(iter(labels))
                identifier = copy_id(label, record["properties"])
                node_map[record["eid"]] = identifier
                nodes_by_label[label].append({"copy_id": identifier, "properties": record["properties"]})
            relationships = []
            result = source.run("MATCH (a)-[r]->(b) WHERE elementId(a) IN $ids AND elementId(b) IN $ids RETURN elementId(a) AS start, elementId(b) AS end, type(r) AS type, properties(r) AS properties", ids=list(node_map))
            for record in result:
                if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", record["type"]):
                    raise ValueError(f"Tipo de relación no permitido: {record['type']!r}")
                relationships.append({"start_id": node_map[record["start"]], "end_id": node_map[record["end"]], "type": record["type"], "properties": record["properties"]})
        with destination_driver.session(database=destination_database) as destination:
            for label in sorted(ALLOWED_LABELS):
                destination.run(
                    f"CREATE INDEX copia_id_{label.lower()} IF NOT EXISTS FOR (n:`{label}`) ON (n._copy_graph_id)"
                ).consume()
            for label, nodes in nodes_by_label.items():
                for batch in batched(nodes, args.lote):
                    destination.execute_write(merge_nodes, batch, label)
            for relationship_type in sorted({row["type"] for row in relationships}):
                selected = [row for row in relationships if row["type"] == relationship_type]
                for batch in batched(selected, args.lote):
                    destination.execute_write(merge_relationships, batch, relationship_type)
        print(f"Copia completada: {len(node_map)} nodos y {len(relationships)} relaciones.")
        return 0
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"Error: {safe_error(exc)}", file=sys.stderr)
        return 1
    except Exception as exc:
        # Los errores del driver pueden incluir la URI de origen; no se vuelcan detalles del TXT.
        print(f"Error de Neo4j ({type(exc).__name__}); revise conectividad y credenciales.", file=sys.stderr)
        return 1
    finally:
        if source_driver is not None:
            source_driver.close()
        if destination_driver is not None:
            destination_driver.close()


if __name__ == "__main__":
    raise SystemExit(main())
