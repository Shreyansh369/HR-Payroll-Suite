import { revokeSession } from "@/server/auth";
import { api, assertSameOrigin, authDeps, clearSessionCookie, ok, readCookie, sessionCookieName } from "@/server/http";

export const POST = api(async (req) => {
  assertSameOrigin(req);
  await revokeSession(authDeps(), readCookie(req, sessionCookieName()));
  return ok({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
});
