import { z } from "zod";
import { changePassword } from "@/server/auth";
import { api, assertSameOrigin, authDeps, ok, readJson, requestMeta, requireSession } from "@/server/http";
import { AppError } from "@/lib/errors";

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const session = await requireSession(req);
  const input = z.object({ current: z.string().max(200), next: z.string().min(12, "Use at least 12 characters.").max(200) }).safeParse(await readJson(req, 4_000));
  if (!input.success) throw new AppError("VALIDATION", input.error.issues[0]?.message ?? "Check the form.");
  await changePassword(authDeps(), session, input.data.current, input.data.next, requestMeta(req));
  return ok({ ok: true });
});
