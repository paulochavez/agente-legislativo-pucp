import { chatJson } from "@/lib/openrouter";
import type { ChatMode } from "@/lib/types";

const ROUTER_PROMPT = `Clasifica una pregunta sobre proyectos de ley.
Devuelve solo JSON: {"route":"graph"} o {"route":"rag"}.
- graph: conteos, listas, personas, cargos, emisores, destinatarios y relaciones estructuradas.
- rag: contenido, resumen, finalidad, argumentos, artículos, exposición de motivos o cualquier respuesta que requiera leer fragmentos del documento.`;

function heuristicRoute(question: string): ChatMode {
  const normalized = question.toLocaleLowerCase("es-PE");
  const ragTerms =
    /\b(qu[eé] dice|contenido|resume|resumen|finalidad|objetiv[oa]|argument|art[ií]culo|exposici[oó]n|fundamento|justifica|propone|explica|tema|trata)\b/i;
  const graphTerms =
    /\b(qui[eé]n|cu[aá]nt|lista|emiti[oó]|emisor|dirigid[oa]|destinatari|cargo|persona|relaci[oó]n|documentos?)\b/i;
  if (ragTerms.test(normalized)) return "rag";
  if (graphTerms.test(normalized)) return "graph";
  return "rag";
}

export async function routeQuestion(
  question: string,
  apiKey: string,
): Promise<ChatMode> {
  try {
    const result = await chatJson(apiKey, ROUTER_PROMPT, question);
    return result.route === "graph" || result.route === "rag"
      ? result.route
      : heuristicRoute(question);
  } catch {
    return heuristicRoute(question);
  }
}
