import { createPortal, stripeClient } from "@/server/billing";
import { buildCtx } from "@/server/context";
import { billingConfigured, serverEnv } from "@/server/env";
import { api, assertSameOrigin, ok, requestMeta, requireSession } from "@/server/http";
import { runtime } from "@/server/runtime";
import { assertPermission } from "@/services/authz";
import { AppError } from "@/lib/errors";

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const env = serverEnv();
  if (!billingConfigured(env) || !env.APP_URL) throw new AppError("NOT_FOUND", "Billing is not enabled for this installation.");
  const session = await requireSession(req);
  const rt = runtime();
  const ctx = await buildCtx({ repo: rt.repo, storage: rt.storage }, session, requestMeta(req));
  assertPermission(ctx.actor, "billing.manage");
  return ok({ url: await createPortal(stripeClient(env), rt.repo, session.user, env.APP_URL.replace(/\/$/, "")) });
});
