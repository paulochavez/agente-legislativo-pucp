# Legisla

Asistente legislativo desarrollado para el Caso de estudio 1 del curso **E-Government de la PUCP**.

**Demo:** https://agente-legislativo-pucp.vercel.app

**Autor:** Paulo Chávez Condori

## Objetivo

Legisla permite consultar en lenguaje natural proyectos de ley del Congreso del Perú. El sistema responde en español, selecciona automáticamente la fuente de información apropiada y presenta citas que permiten identificar el proyecto consultado.

La aplicación atiende dos tipos de preguntas:

- Consultas relacionales sobre autores, emisores, destinatarios, cargos y documentos.
- Consultas de contenido sobre objetivos, artículos, fundamentos, temas y exposiciones de motivos.

## Ejemplos

- `¿Quién emitió el PL 14712?`
- `¿A quién está dirigido el PL 14715?`
- `¿Qué proyectos hablan de educación?`
- `Resume la finalidad del PL 14710.`

## Arquitectura

```text
Pregunta
   |
   v
Agente enrutador
   |-- tool_grafo --> Cypher de solo lectura --> Neo4j Aura
   |
   `-- tool_rag ----> embedding --> índice vectorial --> fragmentos
                                                        |
                                                        v
                                               respuesta con citas
```

Neo4j almacena tanto la información estructurada como los fragmentos documentales:

```text
(:Persona)-[:EMITE]->(:Documento)
(:Documento)-[:DIRIGIDO_A]->(:Persona)
(:Persona)-[:TIENE_EL_CARGO]->(:Cargo)
(:Documento)-[:TIENE_FRAGMENTO]->(:Fragmento)
```

## Datos

El corpus comprende **155 proyectos de ley**, desde el PL 14705 hasta el PL 14859.

- 1,034 páginas procesadas.
- 1,016 fragmentos indexados.
- Extracción de texto nativo y OCR selectivo para páginas escaneadas.
- Embeddings de 2,048 dimensiones.
- Metadatos de proyecto, título, fecha, estado, autores y páginas.

El pipeline de procesamiento e ingesta es reanudable e idempotente.

## Tecnologías

- Next.js 15 y React 19.
- TypeScript.
- Neo4j Aura y búsqueda vectorial.
- OpenRouter para enrutamiento, embeddings y generación de respuestas.
- Python y PyMuPDF para preparación documental.
- Vercel para despliegue.

## Ejecución local

Requisitos:

- Node.js 20 o posterior.
- Una instancia Neo4j Aura previamente poblada.

Las variables requeridas se encuentran documentadas en `.env.example`. Deben configurarse en un archivo local `.env.local`, excluido del control de versiones.

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

La aplicación estará disponible en `http://localhost:3000`.

Como establece el enunciado, la clave de OpenRouter utilizada para realizar preguntas se introduce desde la interfaz y no se almacena en la aplicación.

## Preparación de datos

Los scripts de procesamiento requieren Python 3.11 o posterior:

```bash
python -m pip install -r requirements.txt
python scripts/build_graph.py
python scripts/process_corpus.py
python scripts/ingest.py
python scripts/evaluate.py
```

Los datos ya se encuentran poblados en la instancia utilizada por la demostración desplegada.

## Seguridad

- Las sesiones de consulta a Neo4j utilizan modo de lectura.
- El Cypher generado se valida antes de su ejecución.
- Se bloquean operaciones de escritura y sentencias múltiples.
- Las consultas tienen límites de tiempo y cantidad de filas.
- Los errores públicos no muestran detalles internos.
- Los archivos de entorno y artefactos locales están excluidos del repositorio.

## Verificación

El proyecto fue validado mediante:

- Comprobación estricta de TypeScript.
- Build de producción de Next.js.
- Auditoría de dependencias sin vulnerabilidades conocidas.
- Consultas de integridad sobre documentos, fragmentos y embeddings.
- Pruebas funcionales de rutas relacionales y documentales.

## Estructura

```text
scripts/                 Procesamiento, OCR, grafo, ingesta y evaluación
src/app/api/chat/        Endpoint principal del asistente
src/app/api/schema/      Estado de la base y del índice vectorial
src/lib/router.ts        Selección automática de herramienta
src/lib/graph-tool.ts    Consultas relacionales seguras
src/lib/rag-tool.ts      Recuperación documental y citas
```
