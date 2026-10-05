import { login } from "@/server/auth";
import { api, assertSameOrigin, authDeps, ok, readJson, requestMeta, sessionCookie } from "@/server/http";
import { needsSetup, performSetup } from "@/server/setup";
import { consumeRateLimit } from "@/server/auth";
import { serverEnv } from "@/server/env";
import { runtime } from "@/server/runtime";
import { AppError } from "@/lib/errors";

export const GET = api(async () => {
  const env = serverEnv();
  return ok({ needsSetup: await needsSetup(runtime().db), setupEnabled: !!env.SETUP_TOKEN && env.SETUP_TOKEN.length >= 16 });
});

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const rt = runtime();
  const meta = requestMeta(req);
  const limit = await consumeRateLimit(rt.db, `setup:${meta.ip ?? "unknown"}`, 10, 15 * 60);
  if (!limit.allowed) throw new AppError("RATE_LIMITED", "Too many attempts. Try again later.");
  const body = (await readJson(req, 20_000)) as { owner?: { email?: string; password?: string } };
  const user = await performSetup({ db: rt.db, repo: rt.repo, setupToken: serverEnv().SETUP_TOKEN }, body);
  const result = await login(authDeps(), { email: user.email, password: body.owner?.password ?? "" }, meta);
  if (!result.ok) return ok({ ok: true, signedIn: false });
  return ok({ ok: true, signedIn: true }, { headers: { "set-cookie": sessionCookie(result.token, serverEnv().SESSION_TTL_HOURS * 3600) } });
});
