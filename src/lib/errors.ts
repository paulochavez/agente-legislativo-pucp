import type { ChatFailure } from "@/lib/types";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly status: number,
  ) {
    super(publicMessage);
    this.name = "AppError";
  }
}

export function toPublicError(error: unknown): {
  status: number;
  body: ChatFailure;
} {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: { code: error.code, message: error.publicMessage },
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "No se pudo procesar la solicitud.",
      },
    },
  };
}
