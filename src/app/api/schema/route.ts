import { NextResponse } from "next/server";

import { toPublicError } from "@/lib/errors";
import { executeRead } from "@/lib/neo4j";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [nodes, relationships, vectorIndex] = await Promise.all([
      executeRead(
        "MATCH (n) RETURN labels(n) AS labels, count(n) AS total ORDER BY total DESC",
      ),
      executeRead(
        "MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS total ORDER BY total DESC",
      ),
      executeRead(
        "SHOW INDEXES YIELD name, type, state, populationPercent WHERE name = 'fragmentos_vector' RETURN name, type, state, populationPercent",
      ),
    ]);
    return NextResponse.json({
      ok: true,
      nodes,
      relationships,
      vectorIndex: vectorIndex[0] ?? {
        name: "fragmentos_vector",
        state: "NOT_FOUND",
        populationPercent: 0,
      },
    });
  } catch (error) {
    const failure = toPublicError(error);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}
