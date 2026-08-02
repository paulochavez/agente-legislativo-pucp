import { chatJson } from "@/lib/openrouter";
import type { ChatMode } from "@/lib/types";

const ROUTER_PROMPT = `Clasifica una pregunta sobre proyectos de ley.
Devuelve solo JSON: {"route":"graph"} o {"route":"rag"}.
- graph: conteos, listas, personas, cargos, emisores, destinatarios y relaciones estructuradas.
- rag: contenido, resumen, finalidad, argumentos, artículos, exposición de motivos y búsqueda de proyectos por tema.
Ejemplos obligatorios:
- "¿Quién emitió el PL 14712?" -> graph
- "¿Qué proyectos emitió Susel Paredes?" -> graph
- "¿Qué proyectos hablan de educación?" -> rag
- "¿Cuáles son los proyectos de economía?" -> rag`;

function explicitRoute(question: string): ChatMode | null {
  const normalized = question.toLocaleLowerCase("es-PE");
  const thematicProjects =
    /\b(?:qu[eé]|cu[aá]les)\s+(?:son\s+)?(?:los\s+)?proyectos?\s+(?:de|sobre|acerca\s+de|que\s+(?:hablan|tratan)\s+de)\b/i;
  const contentIntent =
    /\b(?:resume|resumen|finalidad|objetivo|contenido|fundamento|argumento|art[ií]culo|exposici[oó]n\s+de\s+motivos|qu[eé]\s+propone|de\s+qu[eé]\s+trata)\b/i;
  const relationalIntent =
    /\b(?:qui[eé]n\s+(?:emiti[oó]|present[oó]|firma)|a\s+qui[eé]n\s+est[aá]\s+dirigido|cu[aá]ntos?\s+documentos?|qu[eé]\s+proyectos?\s+(?:emiti[oó]|present[oó]))\b/i;

  if (thematicProjects.test(normalized) || contentIntent.test(normalized)) return "rag";
  if (relationalIntent.test(normalized)) return "graph";
  return null;
}

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
  const explicit = explicitRoute(question);
  if (explicit) return explicit;
  try {
    const result = await chatJson(apiKey, ROUTER_PROMPT, question);
    return result.route === "graph" || result.route === "rag"
      ? result.route
      : heuristicRoute(question);
  } catch {
    return heuristicRoute(question);
  }
}
