import { z } from "zod";
import { login } from "@/server/auth";
import { api, assertSameOrigin, authDeps, ok, readJson, requestMeta, sessionCookie } from "@/server/http";
import { serverEnv } from "@/server/env";

const schema = z.object({ email: z.string().trim().max(200), password: z.string().max(200), totp: z.string().max(12).optional() });

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const input = schema.safeParse(await readJson(req, 10_000));
  if (!input.success) return ok({ error: "Enter your email and password." }, { status: 422 });
  const result = await login(authDeps(), input.data, requestMeta(req));
  if (!result.ok) {
    return ok({ error: result.error, needsTotp: result.needsTotp }, { status: result.status, headers: result.retryAfter ? { "retry-after": String(result.retryAfter) } : {} });
  }
  return ok({ ok: true }, { headers: { "set-cookie": sessionCookie(result.token, serverEnv().SESSION_TTL_HOURS * 3600) } });
});
