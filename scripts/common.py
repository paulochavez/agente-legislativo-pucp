"""Utilidades compartidas para los scripts locales del pipeline."""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any, Iterable

import requests


PROJECT_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = PROJECT_DIR.parent
OPENROUTER_URL = "https://openrouter.ai/api/v1"


def load_env(path: Path, *, override: bool = False) -> None:
    """Carga KEY=VALUE sin ejecutar el archivo ni depender de python-dotenv."""
    if not path.exists():
        return
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ValueError(f"Línea inválida en {path.name}:{line_number}; se esperaba KEY=VALUE")
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"Variable inválida en {path.name}:{line_number}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if override or key not in os.environ:
            os.environ[key] = value


def require_env(*names: str) -> list[str]:
    missing = [name for name in names if not os.environ.get(name)]
    if missing:
        raise RuntimeError("Faltan variables de entorno requeridas: " + ", ".join(missing))
    return [os.environ[name] for name in names]


def safe_error(error: BaseException) -> str:
    """Oculta del mensaje cualquier valor de variables que puedan contener secretos."""
    message = str(error)
    for name, value in os.environ.items():
        if value and any(token in name.upper() for token in ("KEY", "PASS", "SECRET", "TOKEN")):
            message = message.replace(value, "[OCULTO]")
    return message


def batched(items: Iterable[Any], size: int) -> Iterable[list[Any]]:
    if size < 1:
        raise ValueError("El tamaño de lote debe ser mayor que cero")
    batch: list[Any] = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def read_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"JSON inválido en {path}:{line_number}") from exc


def atomic_write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def openrouter_post(endpoint: str, payload: dict[str, Any], api_key: str, *, timeout: int = 120,
                    retries: int = 4) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            response = requests.post(
                f"{OPENROUTER_URL}/{endpoint.lstrip('/')}", headers=headers, json=payload, timeout=timeout
            )
            if response.status_code == 429 or response.status_code >= 500:
                raise requests.HTTPError(f"OpenRouter respondió HTTP {response.status_code}")
            response.raise_for_status()
            data = response.json()
            if isinstance(data, dict) and data.get("error"):
                raise RuntimeError(f"OpenRouter devolvió un error: {data['error'].get('message', 'sin detalle')}")
            return data
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"No se pudo completar la solicitud a OpenRouter: {last_error}") from last_error
