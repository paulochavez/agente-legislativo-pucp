import { AppError } from "@/lib/errors";
import type { JsonObject } from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const CHAT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const EMBEDDING_MODEL = "nvidia/nemotron-3-embed-1b:free";
const CHAT_TIMEOUT_MS = 30_000;
const EMBEDDING_TIMEOUT_MS = 20_000;

interface Message {
  role: "system" | "user";
  content: string;
}

async function postOpenRouter(
  path: string,
  apiKey: string,
  body: JsonObject,
  timeoutMs: number,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  const attempts = 3;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);

    try {
      const response = await fetch(`${OPENROUTER_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });

      if (response.ok) return await response.json();
      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          "OPENROUTER_INVALID_KEY",
          "La API key de OpenRouter no es válida o no tiene permisos.",
          401,
        );
      }
      if (response.status === 402) {
        throw new AppError(
          "OPENROUTER_CREDITS",
          "La cuenta de OpenRouter no tiene créditos disponibles.",
          402,
        );
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt + 1 < attempts) {
        await delay(Math.min(400 * 2 ** attempt, Math.max(0, deadline - Date.now())));
        continue;
      }
      if (response.status === 429) {
        throw new AppError(
          "OPENROUTER_RATE_LIMIT",
          "OpenRouter alcanzó el límite temporal de solicitudes. Intenta nuevamente en unos minutos.",
          429,
        );
      }
      throw new AppError(
        "OPENROUTER_ERROR",
        "OpenRouter no pudo completar la solicitud. Intenta nuevamente.",
        502,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === "AbortError") break;
      if (attempt + 1 < attempts) {
        await delay(Math.min(400 * 2 ** attempt, Math.max(0, deadline - Date.now())));
        continue;
      }
      throw new AppError(
        "OPENROUTER_UNAVAILABLE",
        "La conexión con OpenRouter falló temporalmente. Intenta nuevamente.",
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new AppError(
    "OPENROUTER_TIMEOUT",
    "OpenRouter excedió el tiempo de espera. Intenta nuevamente.",
    504,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function chatContent(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = (choices[0] as { message?: unknown })?.message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content.trim() : "";
}

function extractJsonObject(text: string): JsonObject {
  const unfenced = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    const parsed: unknown = JSON.parse(unfenced);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    // Some models add prose around otherwise valid JSON.
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, index + 1));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as JsonObject;
          }
        } catch {
          start = -1;
        }
      }
    }
  }

  throw new AppError(
    "INVALID_LLM_RESPONSE",
    "El servicio de inteligencia artificial devolvió una respuesta inválida.",
    502,
  );
}

async function complete(
  apiKey: string,
  messages: Message[],
  json: boolean,
): Promise<string> {
  const body: JsonObject = {
    model: CHAT_MODEL,
    messages: messages.map((message) => ({ ...message })),
    temperature: 0,
  };
  if (json) body.response_format = { type: "json_object" };

  const data = await postOpenRouter(
    "/chat/completions",
    apiKey,
    body,
    CHAT_TIMEOUT_MS,
  );
  const content = chatContent(data);
  if (!content) {
    throw new AppError(
      "EMPTY_LLM_RESPONSE",
      "El servicio de inteligencia artificial devolvió una respuesta vacía.",
      502,
    );
  }
  return content;
}

export async function chatJson(
  apiKey: string,
  system: string,
  user: string,
): Promise<JsonObject> {
  return extractJsonObject(
    await complete(
      apiKey,
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      true,
    ),
  );
}

export async function chatText(
  apiKey: string,
  system: string,
  user: string,
): Promise<string> {
  return complete(
    apiKey,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    false,
  );
}

export async function createEmbedding(
  apiKey: string,
  input: string,
): Promise<number[]> {
  const data = await postOpenRouter(
    "/embeddings",
    apiKey,
    { model: EMBEDDING_MODEL, input },
    EMBEDDING_TIMEOUT_MS,
  );
  const entries =
    data && typeof data === "object"
      ? (data as { data?: unknown }).data
      : undefined;
  const embedding =
    Array.isArray(entries) && entries.length > 0
      ? (entries[0] as { embedding?: unknown })?.embedding
      : undefined;
  if (
    !Array.isArray(embedding) ||
    embedding.length === 0 ||
    !embedding.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    throw new AppError(
      "INVALID_EMBEDDING",
      "El servicio de inteligencia artificial devolvió un embedding inválido.",
      502,
    );
  }
  return embedding;
}
