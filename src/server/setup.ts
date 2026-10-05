/**
 * First-run setup for a new production installation: creates the customer
 * organisation, system roles, the first company (with draft statutory rules that
 * must be verified and approved) and the owner account.
 *
 * Only possible while the database has no organisation, and only with the
 * SETUP_TOKEN chosen by whoever deployed the application.
 */
import "server-only";
import { z } from "zod";
import { count } from "drizzle-orm";
import { organizations } from "@/db/schema";
import type { Db } from "@/repositories/database/database-repository";
import type { Repository } from "@/repositories/interfaces";
import type { Organization, User } from "@/domain/types";
import { provisionCompany, provisionRoles } from "@/services/provisioning";
import { randomId, type IdGenerator } from "@/lib/ids";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/dates";
import { hashPassword, safeEqual, sha256 } from "@/server/crypto";

export const setupSchema = z.object({
  setupToken: z.string().min(1).max(200),
  organizationName: z.string().trim().min(2).max(200),
  company: z.object({
    legalName: z.string().trim().min(2).max(200),
    tradingName: z.string().trim().max(200).default(""),
    shortName: z.string().trim().min(1).max(4).toUpperCase(),
    currency: z.string().length(3).toUpperCase().default("USD"),
    timezone: z.string().min(3).max(60).default("America/Tortola"),
    payFrequency: z.enum(["weekly", "biweekly", "semi_monthly", "monthly"]).default("monthly"),
  }),
  owner: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.email().max(200),
    password: z.string().min(12).max(200),
  }),
});

export type SetupInput = z.infer<typeof setupSchema>;

export async function needsSetup(db: Db): Promise<boolean> {
  const [{ n }] = await db.select({ n: count() }).from(organizations);
  return Number(n) === 0;
}

export async function performSetup(deps: { db: Db; repo: Repository; setupToken: string | undefined; now?: () => Date }, raw: unknown): Promise<User> {
  if (!deps.setupToken || deps.setupToken.length < 16) throw new AppError("FORBIDDEN", "Setup is disabled. Set a SETUP_TOKEN of at least 16 characters in the server environment.");
  const parsed = setupSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Check the form.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const input = parsed.data;
  // Compare digests so token length is not revealed by timing.
  if (!safeEqual(sha256(input.setupToken), sha256(deps.setupToken))) throw new AppError("FORBIDDEN", "The setup token is not correct.");
  if (input.owner.password.toLowerCase().includes(input.owner.email.split("@")[0].toLowerCase()) && input.owner.email.split("@")[0].length >= 4) {
    throw new AppError("VALIDATION", "Choose a password that does not contain your email name.");
  }
  const passwordHash = await hashPassword(input.owner.password);
  const at = (deps.now ? deps.now() : new Date()).toISOString();
  const ids: IdGenerator = (p) => randomId(p);

  return deps.repo.transaction(async (repo) => {
    if ((await repo.organizations.list()).length > 0) throw new AppError("CONFLICT", "This installation is already set up. Sign in instead.");
    const org: Organization = { id: ids("org"), name: input.organizationName, kind: "customer", createdAt: at, updatedAt: at };
    await repo.organizations.insert(org);
    const roles = await provisionRoles(repo, ids, at, org.id);
    const { company } = await provisionCompany(repo, ids, at, org.id, { ...input.company, tradingName: input.company.tradingName || input.company.legalName }, {
      statutoryStatus: "draft",
      calendarAnchor: `${todayISO(input.company.timezone).slice(0, 4)}-01-05`,
    });
    const owner = roles.find((r) => r.key === "owner")!;
    const user: User = {
      id: ids("usr"),
      organizationId: org.id,
      email: input.owner.email.toLowerCase(),
      name: input.owner.name,
      status: "active",
      memberships: [{ companyId: company.id, roleId: owner.id, scope: "all", employeeId: null, assignedEmployeeIds: [], extraPermissions: [] }],
      passwordHash,
      twoFactor: null,
      lastLoginAt: null,
      createdAt: at,
      updatedAt: at,
    };
    await repo.users.insert(user);
    await repo.audit.append({
      id: ids("aud"),
      organizationId: org.id,
      companyId: company.id,
      at,
      actorId: user.id,
      actorName: user.name,
      action: "setup.completed",
      entityType: "company",
      entityId: company.id,
      summary: `Installation set up: ${org.name}, company ${company.legalName}, owner ${user.email}`,
    });
    return user;
  });
}
