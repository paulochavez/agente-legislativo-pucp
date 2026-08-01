import { NextRequest, NextResponse } from "next/server";

import { AppError, toPublicError } from "@/lib/errors";
import { runGraphTool } from "@/lib/graph-tool";
import { runRagTool } from "@/lib/rag-tool";
import { routeQuestion } from "@/lib/router";
import type { ChatResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requiredString(
  value: unknown,
  field: "question" | "apiKey",
  maximum: number,
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AppError(
      "INVALID_REQUEST",
      field === "question"
        ? `La pregunta debe tener entre 1 y ${maximum} caracteres.`
        : "La clave de API no es válida.",
      400,
    );
  }
  return value.trim();
}

export async function POST(request: NextRequest): Promise<NextResponse<ChatResponse>> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "El cuerpo JSON no es válido.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AppError("INVALID_REQUEST", "La solicitud no es válida.", 400);
    }
    const input = body as Record<string, unknown>;
    const question = requiredString(input.question, "question", 4_000);
    const apiKey = requiredString(input.apiKey, "apiKey", 1_024);
    const mode = await routeQuestion(question, apiKey);
    const response =
      mode === "graph"
        ? await runGraphTool(question, apiKey)
        : await runRagTool(question, apiKey);
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const failure = toPublicError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
