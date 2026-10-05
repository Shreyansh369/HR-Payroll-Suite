/**
 * Single RPC endpoint for every service procedure. The procedure's own input
 * schema, permission and entitlement checks run server-side in `execute`.
 */
import { buildCtx } from "@/server/context";
import { api, assertSameOrigin, ok, readJson, requestMeta, requireSession } from "@/server/http";
import { runtime } from "@/server/runtime";
import { getProcedure } from "@/services/registry";
import { execute } from "@/services/core";
import { AppError } from "@/lib/errors";

export const POST = api(async (req, { params }) => {
  assertSameOrigin(req);
  const { name } = await params;
  const proc = getProcedure(name);
  if (!proc) throw new AppError("NOT_FOUND", "Unknown action.");
  const session = await requireSession(req);
  const rt = runtime();
  const ctx = await buildCtx({ repo: rt.repo, storage: rt.storage }, session, requestMeta(req));
  const data = await execute(proc, ctx, await readJson(req));
  return ok({ data: data ?? null });
});
