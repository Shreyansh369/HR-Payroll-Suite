import { z } from "zod";
import type { StatutoryRule } from "@/domain/types";
import { audit, idSchema, isoDate, mutation, nonEmpty, nowISO, optionalText, query } from "@/services/core";
import { finalizedResults, getCompany } from "@/services/helpers";
import { applyRule, findOverlaps } from "@/domain/statutory/engine";
import { addDays, formatDate } from "@/lib/dates";
import { conflict, invalidState, notFound, validation } from "@/lib/errors";

const amountPeriod = z.enum(["weekly", "monthly", "annual"]);
const rate = z.number().min(0).max(1);

const ruleSchema = z.object({
  type: z.enum(["social_security", "nhi", "payroll_tax", "other"]),
  code: z.string().trim().min(1).max(16).toUpperCase(),
  name: nonEmpty(100),
  jurisdiction: z.string().trim().min(2).max(8).default("VG"),
  employeeRate: rate,
  employerRate: rate,
  employerRateTiers: z.array(z.object({ maxEmployees: z.number().int().min(1).nullable(), rate })).max(10).default([]),
  base: z.enum(["gross", "taxable"]),
  ceiling: z.object({ amount: z.number().positive(), period: amountPeriod, mode: z.enum(["per_period", "annual_cumulative"]) }).nullable(),
  threshold: z.object({ amount: z.number().positive(), period: amountPeriod, mode: z.enum(["exempt_amount", "minimum"]) }).nullable(),
  eligibility: z
    .object({ minAge: z.number().int().min(0).max(120).nullable(), maxAge: z.number().int().min(0).max(120).nullable(), exemptEmploymentTypes: z.array(z.enum(["full_time", "part_time", "contract", "temporary"])).default([]) })
    .nullable(),
  rounding: z.enum(["half_up", "half_even", "down", "up"]),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable(),
  source: z.object({ reference: nonEmpty(300), url: z.union([z.literal(""), z.url()]).default(""), notes: optionalText(1000) }),
});

export const statutoryProcedures = {
  "statutory.list": query({
    input: z.object({}),
    permission: "statutory_rules.view",
    handler: async (ctx) => {
      const rules = await ctx.repo.statutoryRules.list(ctx.actor.companyId);
      return { rules, overlaps: findOverlaps(rules).map(([a, b]) => [a.id, b.id]) };
    },
  }),

  "statutory.save": mutation({
    input: ruleSchema.extend({ id: idSchema.optional() }),
    permission: "statutory_rules.edit",
    handler: async (ctx, input) => {
      if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw validation("Effective-to must be on or after effective-from.");
      if (input.eligibility && input.eligibility.minAge !== null && input.eligibility.maxAge !== null && input.eligibility.minAge > input.eligibility.maxAge) {
        throw validation("Minimum age cannot exceed maximum age.");
      }
      const now = nowISO(ctx);
      const { id, ...data } = input;
      if (id) {
        const before = await ctx.repo.statutoryRules.get(ctx.actor.companyId, id);
        if (!before) throw notFound("Statutory rule");
        if (before.status === "approved" || before.status === "retired") {
          // Approved rules are immutable: create a new draft version instead.
          const draft: StatutoryRule = { ...data, id: ctx.ids("rule"), companyId: ctx.actor.companyId, status: "draft", approval: null, supersedesId: before.id, createdAt: now, updatedAt: now };
          await ctx.repo.statutoryRules.insert(draft);
          await audit(ctx, { action: "statutory.version_created", entityType: "statutory_rule", entityId: draft.id, summary: `Created draft version of ${before.name} effective ${formatDate(draft.effectiveFrom)}`, before, after: draft });
          return draft;
        }
        const updated = await ctx.repo.statutoryRules.update(ctx.actor.companyId, id, { ...data, updatedAt: now });
        await audit(ctx, { action: "statutory.updated", entityType: "statutory_rule", entityId: id, summary: `Updated ${before.status} rule ${input.name}`, before, after: updated });
        return updated;
      }
      const rule: StatutoryRule = { ...data, id: ctx.ids("rule"), companyId: ctx.actor.companyId, status: "draft", approval: null, createdAt: now, updatedAt: now };
      await ctx.repo.statutoryRules.insert(rule);
      await audit(ctx, { action: "statutory.created", entityType: "statutory_rule", entityId: rule.id, summary: `Created draft rule ${rule.name} (${rule.code}) effective ${formatDate(rule.effectiveFrom)}`, after: rule });
      return rule;
    },
  }),

  "statutory.approve": mutation({
    input: z.object({ id: idSchema, note: nonEmpty(500) }),
    permission: "statutory_rules.approve",
    handler: async (ctx, input) => {
      const rule = await ctx.repo.statutoryRules.get(ctx.actor.companyId, input.id);
      if (!rule) throw notFound("Statutory rule");
      if (rule.status === "approved") throw invalidState("This rule is already approved.");
      if (rule.status === "retired") throw invalidState("Retired rules cannot be approved.");
      const all = await ctx.repo.statutoryRules.list(ctx.actor.companyId, { where: { code: rule.code } });
      const now = nowISO(ctx);
      // Close the open-ended predecessor so intervals do not overlap.
      const predecessors = all.filter((r) => r.id !== rule.id && (r.status === "approved" || r.status === "demo") && r.effectiveFrom < rule.effectiveFrom && (!r.effectiveTo || r.effectiveTo >= rule.effectiveFrom));
      const results = await finalizedResults(ctx, { from: rule.effectiveFrom });
      for (const p of predecessors) {
        const used = results.find((r) => r.statutory.some((s) => s.ruleId === p.id) && r.periodEnd >= rule.effectiveFrom);
        if (used) throw conflict(`Finalized payroll for ${formatDate(used.periodEnd)} used the current ${p.name} rule after ${formatDate(rule.effectiveFrom)}. Choose a later effective date or correct that payroll.`);
      }
      const overlappingSameStart = all.filter((r) => r.id !== rule.id && (r.status === "approved" || r.status === "demo") && r.effectiveFrom >= rule.effectiveFrom && (!rule.effectiveTo || r.effectiveFrom <= rule.effectiveTo));
      if (overlappingSameStart.length) throw conflict(`Another active ${rule.code} rule starts on ${formatDate(overlappingSameStart[0].effectiveFrom)} within this rule's dates. Retire or adjust it first.`);
      await ctx.repo.transaction(async (repo) => {
        for (const p of predecessors) await repo.statutoryRules.update(ctx.actor.companyId, p.id, { effectiveTo: addDays(rule.effectiveFrom, -1), updatedAt: now });
        await repo.statutoryRules.update(ctx.actor.companyId, rule.id, { status: "approved", approval: { approvedBy: ctx.actor.userId, approvedByName: ctx.actor.name, approvedAt: now, note: input.note }, updatedAt: now });
      });
      await audit(ctx, {
        action: "statutory.approved",
        entityType: "statutory_rule",
        entityId: rule.id,
        summary: `Approved ${rule.name} (${rule.code}) effective ${formatDate(rule.effectiveFrom)}${predecessors.length ? `; previous version ends ${formatDate(addDays(rule.effectiveFrom, -1))}` : ""}`,
        reason: input.note,
        after: { employeeRate: rule.employeeRate, employerRate: rule.employerRate, ceiling: rule.ceiling, threshold: rule.threshold },
      });
      return { ok: true };
    },
  }),

  "statutory.retire": mutation({
    input: z.object({ id: idSchema, reason: nonEmpty(300) }),
    permission: "statutory_rules.approve",
    handler: async (ctx, input) => {
      const rule = await ctx.repo.statutoryRules.get(ctx.actor.companyId, input.id);
      if (!rule) throw notFound("Statutory rule");
      if (rule.status === "retired") throw invalidState("Already retired.");
      await ctx.repo.statutoryRules.update(ctx.actor.companyId, rule.id, { status: "retired", updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "statutory.retired", entityType: "statutory_rule", entityId: rule.id, summary: `Retired ${rule.name} (${rule.code}) effective ${formatDate(rule.effectiveFrom)}`, reason: input.reason });
      return { ok: true };
    },
  }),

  "statutory.preview": query({
    input: z.object({
      rule: ruleSchema,
      gross: z.number().min(0).max(10_000_000),
      pretax: z.number().min(0).max(10_000_000).default(0),
      frequency: z.enum(["weekly", "biweekly", "semi_monthly", "monthly"]),
      age: z.number().int().min(0).max(120).nullable(),
      ytdContributable: z.number().min(0).default(0),
      headcount: z.number().int().min(1).default(10),
    }),
    permission: "statutory_rules.view",
    handler: async (ctx, input) => {
      const company = await getCompany(ctx);
      const rule = { ...input.rule, id: "preview", companyId: ctx.actor.companyId, status: "draft", createdAt: "", updatedAt: "" } as StatutoryRule;
      return applyRule(rule, {
        grossBase: input.gross,
        taxableBase: Math.max(0, input.gross - input.pretax),
        frequency: input.frequency,
        weeksPerYear: company.payrollSettings.weeksPerYear,
        age: input.age,
        employmentType: "full_time",
        headcount: input.headcount,
        ytdContributable: { [input.rule.code]: input.ytdContributable },
        currency: company.currency,
      });
    },
  }),
};
