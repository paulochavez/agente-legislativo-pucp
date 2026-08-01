import neo4j, { type Driver, type QueryResult } from "neo4j-driver";

import { AppError } from "@/lib/errors";
import type { JsonObject, JsonValue } from "@/lib/types";

const globalForNeo4j = globalThis as typeof globalThis & {
  __legislativeNeo4jDriver?: Driver;
};

function requiredEnv(name: "NEO4J_URI" | "NEO4J_USER" | "NEO4J_PASS"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError(
      "DATABASE_NOT_CONFIGURED",
      "La base de datos no está configurada.",
      503,
    );
  }
  return value;
}

export function getDriver(): Driver {
  if (!globalForNeo4j.__legislativeNeo4jDriver) {
    globalForNeo4j.__legislativeNeo4jDriver = neo4j.driver(
      requiredEnv("NEO4J_URI"),
      neo4j.auth.basic(requiredEnv("NEO4J_USER"), requiredEnv("NEO4J_PASS")),
      { maxConnectionPoolSize: 20 },
    );
  }
  return globalForNeo4j.__legislativeNeo4jDriver;
}

function normalizeObject(value: object): JsonValue {
  const candidate = value as {
    constructor?: { name?: string };
    elementId?: unknown;
    labels?: unknown;
    type?: unknown;
    properties?: unknown;
    segments?: unknown;
    start?: unknown;
    end?: unknown;
    toString?: () => string;
  };
  const constructorName = candidate.constructor?.name ?? "";

  if (constructorName === "Node" && Array.isArray(candidate.labels)) {
    return {
      elementId: String(candidate.elementId ?? ""),
      labels: candidate.labels.map(String),
      properties: normalizeNeo4j(candidate.properties),
    };
  }
  if (constructorName === "Relationship" && typeof candidate.type === "string") {
    return {
      elementId: String(candidate.elementId ?? ""),
      type: candidate.type,
      properties: normalizeNeo4j(candidate.properties),
    };
  }
  if (constructorName === "Path" && Array.isArray(candidate.segments)) {
    return {
      start: normalizeNeo4j(candidate.start),
      end: normalizeNeo4j(candidate.end),
      segments: normalizeNeo4j(candidate.segments),
    };
  }
  if (
    [
      "Date",
      "DateTime",
      "LocalDateTime",
      "Time",
      "LocalTime",
      "Duration",
      "Point",
    ].includes(constructorName) &&
    typeof candidate.toString === "function"
  ) {
    return candidate.toString();
  }

  const result: JsonObject = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = normalizeNeo4j(nested);
  }
  return result;
}

export function normalizeNeo4j(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeNeo4j);
  if (typeof value === "object") return normalizeObject(value);
  return String(value);
}

function recordsToJson(result: QueryResult): JsonObject[] {
  return result.records.map((record) => {
    const row: JsonObject = {};
    for (const key of record.keys) {
      row[String(key)] = normalizeNeo4j(record.get(key));
    }
    return row;
  });
}

export async function executeRead(
  query: string,
  parameters: Record<string, unknown> = {},
): Promise<JsonObject[]> {
  const session = getDriver().session({
    database: process.env.NEO4J_DATABASE?.trim() || "neo4j",
    defaultAccessMode: neo4j.session.READ,
  });
  try {
    const result = await session.executeRead(
      (transaction) => transaction.run(query, parameters),
      { timeout: 15_000 },
    );
    return recordsToJson(result);
  } catch {
    throw new AppError(
      "DATABASE_QUERY_FAILED",
      "No se pudo consultar la base de datos.",
      502,
    );
  } finally {
    await session.close();
  }
}
