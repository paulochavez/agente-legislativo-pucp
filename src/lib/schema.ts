export const GRAPH_SCHEMA = `
Grafo de proyectos de ley del Congreso del Perú.

Nodos estructurados:
- (:Documento {id, numero}): proyecto de ley; numero contiene el número del PL.
- (:Persona {nombre}): congresista, funcionario u otra persona.
- (:Cargo {nombre}): cargo o puesto de una persona.

Relaciones:
- (:Persona)-[:EMITE]->(:Documento)
- (:Documento)-[:DIRIGIDO_A]->(:Persona)
- (:Persona)-[:TIENE_EL_CARGO]->(:Cargo)

Búsqueda semántica:
- (:Fragmento): fragmento textual de un documento, con propiedades texto y paginas.
- Índice vectorial: fragmentos_vector.
`;

export const CYPHER_PROMPT = `Eres un generador de consultas Cypher de solo lectura.
${GRAPH_SCHEMA}
Devuelve exclusivamente JSON: {"cypher":"...","explanation":"..."}.
Reglas:
- Genera exactamente una consulta que empiece con MATCH, OPTIONAL MATCH, WITH, UNWIND o RETURN.
- Solo puedes leer. Nunca uses CREATE, MERGE, DELETE, DETACH, SET, REMOVE, DROP, CALL, LOAD CSV ni FOREACH.
- No uses comentarios ni punto y coma.
- No uses parámetros con $; escribe los valores de búsqueda como literales Cypher.
- Usa comparaciones case-insensitive para texto: toLower(valor) CONTAINS toLower('texto').
- Devuelve aliases descriptivos. Cuando participe un Documento, incluye d.numero AS documento.
- Limita de forma razonable los resultados; el servidor aplicará además un máximo efectivo.
- No consultes embeddings ni Fragmento: esas preguntas corresponden a otra herramienta.
- Si no puede responderse, devuelve una consulta de lectura que produzca cero filas.
`;
