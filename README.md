# Legisla: agente Grafo + RAG

Caso de estudio 1 del curso E-Government de la PUCP. El agente recibe preguntas en español sobre los proyectos de ley PL 14705 a PL 14859 y decide entre dos herramientas:

- **Grafo Neo4j:** personas, emisores, destinatarios, cargos, relaciones y conteos.
- **RAG:** contenido, finalidad, artículos, fundamentos y temas presentes en los PDF.

La respuesta indica la herramienta utilizada y cita sus fuentes como `[PL 14712]` o `[PL 14712, p. 4]`.

## Arquitectura

```text
Pregunta -> Router LLM -> tool_grafo -> Cypher de solo lectura -> Neo4j Aura
                       -> tool_rag   -> embedding -> indice vectorial -> fragmentos
                                                                    -> respuesta citada
```

Neo4j conserva el grafo estructurado y el índice vectorial:

```text
(:Persona)-[:EMITE]->(:Documento)
(:Documento)-[:DIRIGIDO_A]->(:Persona)
(:Persona)-[:TIENE_EL_CARGO]->(:Cargo)
(:Documento)-[:TIENE_FRAGMENTO]->(:Fragmento)
```

## Datos

El corpus fuente no se duplica en este repositorio. Se lee desde:

```text
../ejemplo_clase/proyecto_ley/_indice.csv
../ejemplo_clase/proyecto_ley/PL_*.pdf
```

Contiene 155 proyectos, del PL 14705 al PL 14859. El pipeline extrae texto por página y aplica OCR con OpenRouter únicamente cuando una página tiene menos de 50 caracteres útiles. Tanto el procesamiento como la ingesta son reanudables e idempotentes.

## Configuración local

Copiar `.env.example` como `.env.local` y completar:

```dotenv
NEO4J_URI=neo4j+s://xxxxxxxx.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASS=tu-contrasena
NEO4J_DATABASE=neo4j
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
```

`.env.local` está excluido por `.gitignore`. `OPENROUTER_API_KEY` se utiliza solo para preparar los datos y no debe configurarse en Vercel. En la aplicación, cada evaluador introduce su propia clave.

## Preparar los datos

Requiere Python 3.11 o posterior.

```bash
python -m pip install -r requirements.txt
python scripts/build_graph.py
python scripts/process_corpus.py
python scripts/ingest.py
python scripts/evaluate.py
```

`copy_graph.py` permite replicar la instancia usada en clase si sigue disponible. Si no está disponible, `build_graph.py` reconstruye los nodos y relaciones desde el CSV y las portadas de los PDF. Los checkpoints quedan en `processed/` y permiten repetir cada comando sin empezar desde cero. Para hacer una prueba limitada:

```bash
python scripts/process_corpus.py --limite 3
```

## Aplicación web

Requiere Node.js 20 o posterior. En este equipo se utilizó la distribución ZIP oficial de Node 22, sin instalación ni permisos de administrador.

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

Abrir `http://localhost:3000`, introducir una API key de OpenRouter y probar:

- `¿Quién emitió el PL 14712?` debe elegir **Grafo**.
- `¿Qué proyectos hablan de educación?` debe elegir **RAG**.

## Seguridad

- La clave OpenRouter del visitante permanece en memoria en la pestaña y no se almacena.
- La sesión Neo4j de la aplicación usa modo de acceso de lectura.
- El Cypher generado se valida antes de ejecutarse.
- Se rechazan escrituras, procedimientos, comentarios, parámetros generados y sentencias múltiples.
- Las consultas tienen timeout y límite efectivo de filas.
- Los errores públicos no incluyen credenciales ni detalles internos.

Para defensa adicional, la cuenta Neo4j configurada en Vercel debe tener únicamente permisos de lectura si el plan de Aura lo permite.

## Despliegue en Vercel

Importar el repositorio como proyecto Next.js y configurar únicamente:

```text
NEO4J_URI
NEO4J_USER
NEO4J_PASS
NEO4J_DATABASE
```

Después del despliegue, verificar `/api/schema` y las dos preguntas de prueba. Los datos deben estar poblados previamente en Aura; Vercel no procesa PDFs durante el build.

## Estructura

```text
scripts/                 Extracción, OCR, copia del grafo, ingesta y evaluación
src/app/api/chat/        Endpoint del agente
src/app/api/schema/      Estado de Aura e índice vectorial
src/lib/router.ts        Decisión Grafo/RAG
src/lib/graph-tool.ts    Generación y ejecución segura de Cypher
src/lib/rag-tool.ts      Retrieval vectorial y respuesta con citas
processed/               Checkpoints locales ignorados por Git
```
