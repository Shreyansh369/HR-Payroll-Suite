import { z } from "zod";
import { switchSessionCompany } from "@/server/auth";
import { api, assertSameOrigin, authDeps, ok, readJson, requestMeta, requireSession } from "@/server/http";
import { AppError } from "@/lib/errors";

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const session = await requireSession(req);
  const input = z.object({ companyId: z.string().min(1).max(64) }).safeParse(await readJson(req, 2_000));
  if (!input.success) throw new AppError("VALIDATION", "Choose a company.");
  await switchSessionCompany(authDeps(), session, input.data.companyId, requestMeta(req));
  return ok({ ok: true });
});
