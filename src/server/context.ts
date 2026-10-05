/**
 * Builds the procedure context for an authenticated production request.
 * Authorization is resolved from the database on every request; nothing the
 * client sends (role, company, permissions) is trusted.
 */
import "server-only";
import type { Repository, DocumentStorage } from "@/repositories/interfaces";
import type { Ctx } from "@/services/core";
import { resolveActor } from "@/services/authz";
import { evaluateEntitlements } from "@/services/entitlements";
import { randomId } from "@/lib/ids";
import type { RequestMeta, SessionRecord } from "@/server/auth";
import { hashPassword } from "@/server/crypto";
import { billingConfigured } from "@/server/env";

export async function buildCtx(deps: { repo: Repository; storage: DocumentStorage; billingEnabled?: boolean; now?: () => Date }, session: Pick<SessionRecord, "userId" | "companyId" | "user">, meta: RequestMeta): Promise<Ctx> {
  const now = deps.now ?? (() => new Date());
  const [actor, license] = await Promise.all([resolveActor(deps.repo, session.userId, session.companyId), deps.repo.licenses.getByOrganization(session.user.organizationId)]);
  return {
    actor,
    repo: deps.repo,
    storage: deps.storage,
    mode: "production",
    entitlements: evaluateEntitlements(license, "production", now(), deps.billingEnabled ?? billingConfigured()),
    now,
    ids: (prefix) => randomId(prefix),
    meta,
    security: { hashPassword },
  };
}
