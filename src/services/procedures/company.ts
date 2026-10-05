import { z } from "zod";
import type { Company, Department } from "@/domain/types";
import { PERMISSIONS } from "@/domain/auth/permissions";
import { audit, diff, isoDate, mutation, nonEmpty, nowISO, query, idSchema, companyToday } from "@/services/core";
import { getCompany } from "@/services/helpers";
import { hasPermission } from "@/services/authz";
import { provisionCompany } from "@/services/provisioning";
import { conflict, notFound } from "@/lib/errors";

const addressSchema = z.object({
  line1: z.string().trim().max(200),
  line2: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().max(100),
  region: z.string().trim().max(100).optional().default(""),
  postalCode: z.string().trim().max(20).optional().default(""),
  country: z.string().trim().max(100),
});

export const companyProcedures = {
  "session.context": query({
    input: z.object({}),
    permission: null,
    handler: async (ctx) => {
      const company = await getCompany(ctx);
      const companies: { id: string; legalName: string; tradingName: string; shortName: string; accentColor: string }[] = [];
      for (const id of ctx.actor.companyIds) {
        const c = await ctx.repo.companies.get(id);
        if (c) companies.push({ id: c.id, legalName: c.legalName, tradingName: c.tradingName, shortName: c.branding.shortName, accentColor: c.branding.accentColor });
      }
      return {
        mode: ctx.mode,
        user: { id: ctx.actor.userId, name: ctx.actor.name, email: ctx.actor.email },
        company: {
          id: company.id,
          legalName: company.legalName,
          tradingName: company.tradingName,
          shortName: company.branding.shortName,
          accentColor: company.branding.accentColor,
          currency: company.currency,
          timezone: company.timezone,
        },
        companies,
        role: ctx.actor.role,
        scope: ctx.actor.scope,
        employeeId: ctx.actor.employeeId,
        permissions: PERMISSIONS.filter((p) => ctx.actor.permissions.has(p)),
        today: await companyToday(ctx),
        entitlements: {
          active: ctx.entitlements.active,
          plan: ctx.entitlements.plan,
          status: ctx.entitlements.status,
          features: [...ctx.entitlements.features],
          reason: ctx.entitlements.reason,
        },
      };
    },
  }),

  "company.get": query({
    input: z.object({}),
    permission: ["company.view", "company.manage", "payroll.view"],
    handler: async (ctx) => getCompany(ctx),
  }),

  "company.update": mutation({
    input: z.object({
      legalName: nonEmpty(200),
      tradingName: z.string().trim().max(200),
      registrationNumber: z.string().trim().max(100),
      address: addressSchema,
      contactEmail: z.union([z.literal(""), z.email()]),
      contactPhone: z.string().trim().max(50),
      currency: z.string().length(3).toUpperCase(),
      timezone: z.string().min(1).max(64),
      fiscalYearStartMonth: z.number().int().min(1).max(12),
      employerIds: z.object({ socialSecurity: z.string().max(50), nhi: z.string().max(50), payrollTax: z.string().max(50) }),
      branding: z.object({ accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), shortName: z.string().trim().min(1).max(4) }),
    }),
    permission: "company.manage",
    handler: async (ctx, input) => {
      const before = await getCompany(ctx);
      const patch: Partial<Company> = { ...input, tradingName: input.tradingName || input.legalName, updatedAt: nowISO(ctx) };
      const updated = await ctx.repo.companies.update(before.id, patch);
      const d = diff(before, input);
      if (d) await audit(ctx, { action: "company.updated", entityType: "company", entityId: before.id, summary: `Updated company profile`, ...d });
      return updated;
    },
  }),

  "company.updatePayrollSettings": mutation({
    input: z.object({
      payrollSettings: z.object({
        jurisdiction: z.string().min(2).max(8),
        weeksPerYear: z.number().min(50).max(53),
        dailyRateMethod: z.enum(["annual_working_days", "fixed_days_per_month", "calendar_days"]),
        fixedDaysPerMonth: z.number().min(15).max(31),
        prorationMethod: z.enum(["working_days", "calendar_days"]),
        overtimeMultiplier: z.number().min(1).max(4),
        hourlyFallbackToSchedule: z.boolean(),
        roundingMode: z.enum(["half_up", "half_even", "down", "up"]),
        statutoryDateBasis: z.enum(["period_end", "pay_date"]),
        varianceWarningThreshold: z.number().min(0.01).max(5),
        maxDeductionRatio: z.number().min(0.05).max(1),
      }),
      payCalendars: z
        .array(
          z.object({
            frequency: z.enum(["weekly", "biweekly", "semi_monthly", "monthly"]),
            anchorDate: isoDate,
            payDateOffsetDays: z.number().int().min(-10).max(15),
            active: z.boolean(),
          }),
        )
        .min(1)
        .refine((xs) => new Set(xs.map((x) => x.frequency)).size === xs.length, "Only one calendar per frequency"),
      holidays: z.array(z.object({ date: isoDate, name: nonEmpty(100) })).max(200),
    }),
    permission: "company.manage",
    handler: async (ctx, input) => {
      const before = await getCompany(ctx);
      const holidays = [...input.holidays].sort((a, b) => a.date.localeCompare(b.date));
      const updated = await ctx.repo.companies.update(before.id, { ...input, holidays, updatedAt: nowISO(ctx) });
      const d = diff(before, { ...input, holidays });
      if (d) {
        await audit(ctx, {
          action: "company.payroll_settings_updated",
          entityType: "company",
          entityId: before.id,
          summary: "Updated payroll settings, calendars or holidays",
          ...d,
        });
      }
      return updated;
    },
  }),

  "company.updateAccountMappings": mutation({
    input: z.object({
      accountMappings: z.array(z.object({ key: z.string(), accountName: z.string().trim().max(200), accountCode: z.string().trim().max(40) })),
    }),
    permission: ["company.manage", "accounting.export"],
    handler: async (ctx, input) => {
      const before = await getCompany(ctx);
      const byKey = new Map(input.accountMappings.map((m) => [m.key, m]));
      const accountMappings = before.accountMappings.map((m) => ({ ...m, ...(byKey.get(m.key) ?? {}), key: m.key }));
      const updated = await ctx.repo.companies.update(before.id, { accountMappings, updatedAt: nowISO(ctx) });
      await audit(ctx, {
        action: "accounting.mappings_updated",
        entityType: "company",
        entityId: before.id,
        summary: "Updated accounting account mappings",
        before: before.accountMappings,
        after: accountMappings,
      });
      return updated;
    },
  }),

  "company.updateSetup": mutation({
    input: z.object({ step: z.string().max(40), done: z.boolean() }),
    permission: "company.manage",
    handler: async (ctx, input) => {
      const company = await getCompany(ctx);
      const steps = new Set(company.setup.completedSteps);
      if (input.done) steps.add(input.step);
      else steps.delete(input.step);
      const setup = { ...company.setup, completedSteps: [...steps] };
      if (input.step === "go_live" && input.done) setup.liveSince = await companyToday(ctx);
      await ctx.repo.companies.update(company.id, { setup, updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "company.setup_step", entityType: "company", entityId: company.id, summary: `${input.done ? "Completed" : "Reopened"} setup step "${input.step}"` });
      return setup;
    },
  }),

  "company.create": mutation({
    input: z.object({
      legalName: nonEmpty(200),
      tradingName: z.string().trim().max(200).default(""),
      shortName: z.string().trim().min(1).max(4),
      currency: z.string().length(3).toUpperCase().default("USD"),
      timezone: z.string().default("America/Tortola"),
      payFrequency: z.enum(["weekly", "biweekly", "semi_monthly", "monthly"]).default("monthly"),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#1f5c4d"),
    }),
    permission: "company.manage",
    feature: "multi_company",
    handler: async (ctx, input) => {
      const now = nowISO(ctx);
      const today = await companyToday(ctx);
      const { company } = await ctx.repo.transaction(async (repo) => {
        const result = await provisionCompany(repo, ctx.ids, now, ctx.actor.organizationId, input, {
          statutoryStatus: ctx.mode === "demo" ? "demo" : "draft",
          calendarAnchor: `${today.slice(0, 4)}-01-05`,
        });
        // Grant every organisation owner access to the new company.
        const roles = await repo.roles.listByOrganization(ctx.actor.organizationId);
        const ownerRole = roles.find((r) => r.key === "owner");
        const users = await repo.users.listByOrganization(ctx.actor.organizationId);
        for (const u of users) {
          const isCreator = u.id === ctx.actor.userId;
          const isOwner = u.memberships.some((m) => m.roleId === ownerRole?.id);
          if (!isCreator && !isOwner) continue;
          const roleId = isOwner && ownerRole ? ownerRole.id : u.memberships.find((m) => m.companyId === ctx.actor.companyId)?.roleId;
          if (!roleId) continue;
          await repo.users.update(u.id, { memberships: [...u.memberships, { companyId: result.company.id, roleId, scope: "all", employeeId: null }], updatedAt: now });
        }
        return result;
      });
      await audit(ctx, { action: "company.created", entityType: "company", entityId: company.id, companyId: company.id, summary: `Created company ${company.legalName}` });
      return company;
    },
  }),

  "departments.list": query({
    input: z.object({}),
    permission: ["employee.view", "self.view", "payroll.view"],
    handler: async (ctx) => {
      const [deps, employees] = await Promise.all([
        ctx.repo.departments.list(ctx.actor.companyId),
        hasPermission(ctx.actor, "employee.view") ? ctx.repo.employees.list(ctx.actor.companyId, { where: { status: ["active", "on_leave", "onboarding"] } }) : Promise.resolve([]),
      ]);
      return deps.map((dep) => ({ ...dep, headcount: employees.filter((e) => e.departmentId === dep.id).length }));
    },
  }),

  "departments.save": mutation({
    input: z.object({ id: idSchema.optional(), name: nonEmpty(100), code: z.string().trim().min(1).max(12).toUpperCase(), parentId: idSchema.nullable().default(null) }),
    permission: ["company.manage", "employee.edit"],
    handler: async (ctx, input) => {
      const now = nowISO(ctx);
      if (input.id) {
        const before = await ctx.repo.departments.get(ctx.actor.companyId, input.id);
        if (!before) throw notFound("Department");
        if (input.parentId === input.id) throw conflict("A department cannot be its own parent.");
        const updated = await ctx.repo.departments.update(ctx.actor.companyId, input.id, { name: input.name, code: input.code, parentId: input.parentId, updatedAt: now });
        await audit(ctx, { action: "department.updated", entityType: "department", entityId: input.id, summary: `Updated department ${input.name}`, ...(diff(before, input) ?? {}) });
        return updated;
      }
      const dep: Department = { id: ctx.ids("dept"), companyId: ctx.actor.companyId, name: input.name, code: input.code, parentId: input.parentId, createdAt: now, updatedAt: now };
      await ctx.repo.departments.insert(dep);
      await audit(ctx, { action: "department.created", entityType: "department", entityId: dep.id, summary: `Created department ${dep.name}` });
      return dep;
    },
  }),

  "departments.delete": mutation({
    input: z.object({ id: idSchema }),
    permission: ["company.manage", "employee.edit"],
    handler: async (ctx, { id }) => {
      const dep = await ctx.repo.departments.get(ctx.actor.companyId, id);
      if (!dep) throw notFound("Department");
      const count = await ctx.repo.employees.count(ctx.actor.companyId, { where: { departmentId: id } });
      if (count > 0) throw conflict(`${count} employee(s) are assigned to ${dep.name}. Move them before deleting it.`);
      await ctx.repo.departments.remove(ctx.actor.companyId, id);
      await audit(ctx, { action: "department.deleted", entityType: "department", entityId: id, summary: `Deleted department ${dep.name}`, before: dep });
      return { ok: true };
    },
  }),
};
