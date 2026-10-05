import { z } from "zod";
import { beginTwoFactor, disableTwoFactor, enableTwoFactor } from "@/server/auth";
import { api, assertSameOrigin, authDeps, ok, readJson, requestMeta, requireSession } from "@/server/http";
import { AppError } from "@/lib/errors";
import { APP_NAME } from "@/config/env";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("begin") }),
  z.object({ action: z.literal("enable"), code: z.string().max(12) }),
  z.object({ action: z.literal("disable"), password: z.string().max(200) }),
]);

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const session = await requireSession(req);
  const input = schema.safeParse(await readJson(req, 4_000));
  if (!input.success) throw new AppError("VALIDATION", "Invalid request.");
  const deps = authDeps();
  switch (input.data.action) {
    case "status":
      return ok({ enabled: !!session.user.twoFactor?.enabled });
    case "begin":
      return ok(await beginTwoFactor(deps, session, APP_NAME));
    case "enable":
      await enableTwoFactor(deps, session, input.data.code, requestMeta(req));
      return ok({ enabled: true });
    case "disable":
      await disableTwoFactor(deps, session, input.data.password, requestMeta(req));
      return ok({ enabled: false });
  }
});
