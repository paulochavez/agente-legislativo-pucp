export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ChatMode = "graph" | "rag";

export interface ChatSource extends JsonObject {
  citation: string;
  projectLaw: string;
  page: number | string | null;
  score: number | null;
}

export interface ChatSuccess extends JsonObject {
  ok: true;
  mode: ChatMode;
  answer: string;
  sources: ChatSource[];
  data: JsonObject;
}

export interface ChatError extends JsonObject {
  code: string;
  message: string;
}

export interface ChatFailure extends JsonObject {
  ok: false;
  error: ChatError;
}

export type ChatResponse = ChatSuccess | ChatFailure;
