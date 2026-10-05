import { api, currentSession, ok } from "@/server/http";

export const GET = api(async (req) => {
  const s = await currentSession(req);
  return ok({ session: s ? { userId: s.userId, companyId: s.companyId } : null });
});
