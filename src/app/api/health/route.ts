import { sql } from "drizzle-orm";
import { serverEnv } from "@/server/env";
import { runtime } from "@/server/runtime";

/** Liveness/readiness probe. Reports configuration problems without exposing values. */
export async function GET() {
  const env = serverEnv();
  if (env.DEMO_MODE) return Response.json({ status: "ok", mode: "demo" }, { headers: { "cache-control": "no-store" } });
  try {
    await runtime().db.execute(sql`select 1`);
    return Response.json({ status: "ok", mode: "production", database: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ status: "error", mode: "production", database: e instanceof Error && /configured/.test(e.message) ? e.message : "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
