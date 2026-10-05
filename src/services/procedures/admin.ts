import { z } from "zod";
import type { Membership, Role, User } from "@/domain/types";
import { PERMISSIONS, type Permission } from "@/domain/auth/permissions";
import { audit, idSchema, isoDate, mutation, nonEmpty, nowISO, query, type Ctx } from "@/services/core";
import { hasPermission } from "@/services/authz";
import { conflict, forbidden, notFound, validation } from "@/lib/errors";

const membershipSchema = z.object({
  companyId: idSchema,
  roleId: idSchema,
  scope: z.enum(["all", "team", "self"]),
  employeeId: idSchema.nullable().default(null),
  assignedEmployeeIds: z.array(idSchema).default([]),
  extraPermissions: z.array(z.enum(PERMISSIONS)).default([]),
});

function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, status: u.status, memberships: u.memberships, lastLoginAt: u.lastLoginAt ?? null, twoFactorEnabled: !!u.twoFactor?.enabled, createdAt: u.createdAt };
}

async function validateMemberships(ctx: Ctx, memberships: Membership[]) {
  const roles = await ctx.repo.roles.listByOrganization(ctx.actor.organizationId);
  const ownerRole = roles.find((r) => r.key === "owner");
  for (const m of memberships) {
    const company = await ctx.repo.companies.get(m.companyId);
    if (!company || company.organizationId !== ctx.actor.organizationId) throw validation("Unknown company in memberships.");
    if (!roles.some((r) => r.id === m.roleId)) throw validation("Unknown role.");
    if (!ctx.actor.companyIds.includes(m.companyId)) throw forbidden("You can only grant access to companies you can access.");
    if (m.roleId === ownerRole?.id && ctx.actor.role.key !== "owner") throw forbidden("Only an owner can grant the Owner role.");
    if (m.employeeId) {
      const e = await ctx.repo.employees.get(m.companyId, m.employeeId);
      if (!e) throw validation("Linked employee not found in that company.");
    }
    if (m.extraPermissions?.length && !m.extraPermissions.every((p) => hasPermission(ctx.actor, p))) {
      throw forbidden("You cannot grant permissions you do not hold.");
    }
  }
  return { ownerRole };
}

export const adminProcedures = {
  "users.list": query({
    input: z.object({}),
    permission: "users.manage",
    handler: async (ctx) => {
      const [users, roles] = await Promise.all([ctx.repo.users.listByOrganization(ctx.actor.organizationId), ctx.repo.roles.listByOrganization(ctx.actor.organizationId)]);
      return { users: users.map(publicUser), roles };
    },
  }),

  "users.create": mutation({
    input: z.object({ email: z.email(), name: nonEmpty(120), memberships: z.array(membershipSchema).min(1), initialPassword: z.string().min(12).max(200).optional() }),
    permission: "users.manage",
    handler: async (ctx, input) => {
      await validateMemberships(ctx, input.memberships);
      if (await ctx.repo.users.getByEmail(input.email)) throw conflict("A user with this email already exists.");
      let passwordHash: string | null = null;
      if (ctx.mode === "production") {
        if (!input.initialPassword) throw validation("Set an initial password of at least 12 characters.");
        if (!ctx.security) throw forbidden("Password hashing is unavailable.");
        passwordHash = await ctx.security.hashPassword(input.initialPassword);
      }
      const now = nowISO(ctx);
      const user: User = { id: ctx.ids("usr"), organizationId: ctx.actor.organizationId, email: input.email.toLowerCase(), name: input.name, status: "active", memberships: input.memberships, passwordHash, twoFactor: null, lastLoginAt: null, createdAt: now, updatedAt: now };
      await ctx.repo.users.insert(user);
      for (const m of input.memberships) {
        if (m.employeeId) await ctx.repo.employees.update(m.companyId, m.employeeId, { userId: user.id, updatedAt: now });
      }
      await audit(ctx, { action: "user.created", entityType: "user", entityId: user.id, companyId: null, summary: `Created user ${user.email}`, after: publicUser(user) });
      return publicUser(user);
    },
  }),

  "users.update": mutation({
    input: z.object({ id: idSchema, name: nonEmpty(120), status: z.enum(["active", "disabled"]), memberships: z.array(membershipSchema) }),
    permission: "users.manage",
    handler: async (ctx, input) => {
      const before = await ctx.repo.users.get(input.id);
      if (!before || before.organizationId !== ctx.actor.organizationId) throw notFound("User");
      const { ownerRole } = await validateMemberships(ctx, input.memberships);
      if (input.id === ctx.actor.userId && input.status === "disabled") throw conflict("You cannot disable your own account.");
      // Memberships for companies the actor cannot access are preserved untouched.
      const hidden = before.memberships.filter((m) => !ctx.actor.companyIds.includes(m.companyId));
      const memberships = [...hidden, ...input.memberships];
      if (ownerRole) {
        const users = await ctx.repo.users.listByOrganization(ctx.actor.organizationId);
        const ownersAfter = users.filter((u) => {
          const ms = u.id === input.id ? memberships : u.memberships;
          const st = u.id === input.id ? input.status : u.status;
          return st === "active" && ms.some((m) => m.roleId === ownerRole.id);
        });
        if (ownersAfter.length === 0) throw conflict("The organisation must keep at least one active owner.");
      }
      const now = nowISO(ctx);
      const updated = await ctx.repo.users.update(input.id, { name: input.name, status: input.status, memberships, updatedAt: now });
      for (const m of input.memberships) {
        if (m.employeeId) await ctx.repo.employees.update(m.companyId, m.employeeId, { userId: input.id, updatedAt: now });
      }
      await audit(ctx, { action: "user.updated", entityType: "user", entityId: input.id, companyId: null, summary: `Updated access for ${before.email}`, before: publicUser(before), after: publicUser(updated) });
      return publicUser(updated);
    },
  }),

  "roles.list": query({
    input: z.object({}),
    permission: ["users.manage", "roles.manage"],
    handler: async (ctx) => ctx.repo.roles.listByOrganization(ctx.actor.organizationId),
  }),

  "roles.save": mutation({
    input: z.object({ id: idSchema.optional(), name: nonEmpty(60), description: z.string().trim().max(300), permissions: z.array(z.enum(PERMISSIONS)), defaultScope: z.enum(["all", "team", "self"]) }),
    permission: "roles.manage",
    handler: async (ctx, input) => {
      if (!input.permissions.every((p) => hasPermission(ctx.actor, p as Permission))) throw forbidden("You cannot grant permissions you do not hold.");
      const now = nowISO(ctx);
      if (input.id) {
        const before = await ctx.repo.roles.get(input.id);
        if (!before || before.organizationId !== ctx.actor.organizationId) throw notFound("Role");
        if (before.system) throw conflict("System roles cannot be edited. Create a custom role instead.");
        const updated = await ctx.repo.roles.update(input.id, { ...input, updatedAt: now });
        await audit(ctx, { action: "role.updated", entityType: "role", entityId: input.id, companyId: null, summary: `Updated role ${input.name}`, before, after: updated });
        return updated;
      }
      const role: Role = { id: ctx.ids("role"), organizationId: ctx.actor.organizationId, key: `custom_${Date.now().toString(36)}`, ...input, system: false, createdAt: now, updatedAt: now };
      await ctx.repo.roles.insert(role);
      await audit(ctx, { action: "role.created", entityType: "role", entityId: role.id, companyId: null, summary: `Created role ${role.name}`, after: role });
      return role;
    },
  }),

  "audit.list": query({
    input: z.object({
      entityType: z.string().max(40).optional(),
      entityId: idSchema.optional(),
      action: z.string().max(60).optional(),
      actorId: idSchema.optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      search: z.string().max(100).optional(),
      allCompanies: z.boolean().default(false),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(10).max(500).default(50),
    }),
    permission: "audit.view",
    handler: async (ctx, input) => {
      const page = await ctx.repo.audit.list(ctx.actor.organizationId, {
        companyId: input.allCompanies ? undefined : ctx.actor.companyId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        actorId: input.actorId,
        from: input.from ? `${input.from}T00:00:00.000Z` : undefined,
        to: input.to ? `${input.to}T23:59:59.999Z` : undefined,
        search: input.search,
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
      });
      // Organisation-level events (users, roles) are visible only with users.manage.
      const items = page.items.filter((e) => e.companyId === null ? hasPermission(ctx.actor, "users.manage") : ctx.actor.companyIds.includes(e.companyId));
      return { items, total: page.total, page: input.page, pageSize: input.pageSize };
    },
  }),

  "audit.logExport": mutation({
    input: z.object({ kind: z.enum(["report", "payslip", "payslips_bulk", "journal", "import_template", "rejected_rows", "demo_export"]), title: nonEmpty(200), format: z.enum(["pdf", "xlsx", "csv", "zip", "json"]), rows: z.number().int().min(0).default(0), entityId: idSchema.optional() }),
    permission: null,
    handler: async (ctx, input) => {
      await audit(ctx, { action: "export.generated", entityType: input.kind, entityId: input.entityId ?? null, summary: `Exported ${input.title} (${input.format.toUpperCase()}${input.rows ? `, ${input.rows} rows` : ""})` });
      return { ok: true };
    },
  }),

  "billing.status": query({
    input: z.object({}),
    permission: null,
    handler: async (ctx) => {
      const license = await ctx.repo.licenses.getByOrganization(ctx.actor.organizationId);
      const canManage = hasPermission(ctx.actor, "billing.manage");
      return {
        canManage,
        entitlements: { active: ctx.entitlements.active, plan: ctx.entitlements.plan, status: ctx.entitlements.status, reason: ctx.entitlements.reason, features: [...ctx.entitlements.features], employeeLimit: ctx.entitlements.employeeLimit },
        license: canManage && license
          ? { plan: license.plan, status: license.status, trialEnd: license.trialEnd ?? null, maintenanceUntil: license.maintenanceUntil ?? null, subscriptionFreeUntil: license.subscriptionFreeUntil ?? null, activatedAt: license.activatedAt ?? null, hasCustomer: !!license.stripeCustomerId }
          : null,
      };
    },
  }),
};
