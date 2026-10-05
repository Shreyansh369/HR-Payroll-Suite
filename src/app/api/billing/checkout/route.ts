import { z } from "zod";
import { createCheckout, stripeClient } from "@/server/billing";
import { buildCtx } from "@/server/context";
import { billingConfigured, serverEnv } from "@/server/env";
import { api, assertSameOrigin, ok, readJson, requestMeta, requireSession } from "@/server/http";
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
  const input = z.object({ plan: z.enum(["hosted", "owned"]) }).safeParse(await readJson(req, 1_000));
  if (!input.success) throw new AppError("VALIDATION", "Choose a plan.");
  const url = await createCheckout({ stripe: stripeClient(env), repo: rt.repo, env }, session.user, input.data.plan, env.APP_URL.replace(/\/$/, ""));
  return ok({ url });
});
