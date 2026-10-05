import { z } from "zod";
import type { Loan, PayItem } from "@/domain/types";
import { audit, companyToday, idSchema, isoDate, money, mutation, nonEmpty, nowISO, optionalText, query } from "@/services/core";
import { departmentNames, displayName, finalizedResults, getCompany, getScopedEmployee, lastFinalizedPeriodEnd, loanOutstanding, scopeWhere } from "@/services/helpers";
import { rateInput, scheduleInput } from "@/services/procedures/employees";
import { effectiveOn, withEffectiveTo } from "@/domain/employee/schedule";
import { rateEquivalents } from "@/domain/payroll/rates";
import { yearOf, formatDate } from "@/lib/dates";
import { conflict, notFound, validation } from "@/lib/errors";

async function guardRetro(ctx: Parameters<typeof getCompany>[0], employeeId: string, effectiveFrom: string) {
  const end = await lastFinalizedPeriodEnd(ctx, employeeId);
  if (end && effectiveFrom <= end) {
    throw conflict(
      `The effective date falls inside a finalized payroll period (through ${formatDate(end)}). Choose a date after ${formatDate(end)}, or record a retroactive adjustment in a correction run.`,
    );
  }
}

const n4 = (x: { toDecimalPlaces: (n: number) => { toString(): string } }) => Number(x.toDecimalPlaces(4).toString());

export const compensationProcedures = {
  "compensation.get": query({
    input: z.object({ employeeId: idSchema }),
    permission: "salary.view",
    handler: async (ctx, { employeeId }) => {
      const e = await getScopedEmployee(ctx, employeeId);
      const company = await getCompany(ctx);
      const today = await companyToday(ctx);
      const [rates, schedules, items, loans, results] = await Promise.all([
        ctx.repo.payRates.list(ctx.actor.companyId, { where: { employeeId } }),
        ctx.repo.schedules.list(ctx.actor.companyId, { where: { employeeId } }),
        ctx.repo.payItems.list(ctx.actor.companyId, { where: { employeeId } }),
        ctx.repo.loans.list(ctx.actor.companyId, { where: { employeeId } }),
        finalizedResults(ctx, { employeeId }),
      ]);
      const currentRate = effectiveOn(rates, today) ?? rates[rates.length - 1] ?? null;
      const currentSchedule = effectiveOn(schedules, today) ?? schedules[schedules.length - 1] ?? null;
      let equivalents = null;
      if (currentRate && currentSchedule) {
        const eq = rateEquivalents(
          currentRate.amount,
          currentRate.basis,
          { daysPerWeek: currentSchedule.workDays.length, hoursPerDay: currentSchedule.hoursPerDay },
          company.payrollSettings,
          yearOf(today),
        );
        equivalents = {
          annual: n4(eq.annual),
          monthly: n4(eq.monthly),
          semiMonthly: n4(eq.semiMonthly),
          biweekly: n4(eq.biweekly),
          weekly: n4(eq.weekly),
          daily: n4(eq.daily),
          hourly: n4(eq.hourly),
          formulas: eq.formulas,
          assumptions: eq.assumptions,
        };
      }
      const lockedThrough = await lastFinalizedPeriodEnd(ctx, employeeId);
      return {
        employee: { id: e.id, name: displayName(e), hireDate: e.hireDate },
        currency: company.currency,
        settings: company.payrollSettings,
        rates: withEffectiveTo(rates).reverse(),
        schedules: withEffectiveTo(schedules).reverse(),
        currentRate,
        currentSchedule,
        equivalents,
        payItems: items,
        loans: loans.map((l) => ({ ...l, ...loanOutstanding(l, results) })),
        lockedThrough,
      };
    },
  }),

  "compensation.addRate": mutation({
    input: rateInput.extend({ employeeId: idSchema, effectiveFrom: isoDate, reason: nonEmpty(200) }),
    permission: "salary.edit",
    feature: "payroll",
    handler: async (ctx, input) => {
      const e = await getScopedEmployee(ctx, input.employeeId);
      if (input.effectiveFrom < e.hireDate) throw validation("The effective date cannot be before the hire date.");
      await guardRetro(ctx, e.id, input.effectiveFrom);
      const rates = await ctx.repo.payRates.list(ctx.actor.companyId, { where: { employeeId: e.id } });
      const previous = effectiveOn(rates, input.effectiveFrom);
      const now = nowISO(ctx);
      const { employeeId, ...rest } = input;
      const rate = { id: ctx.ids("rate"), companyId: ctx.actor.companyId, employeeId, ...rest, createdBy: ctx.actor.userId, createdAt: now, updatedAt: now };
      await ctx.repo.payRates.insert(rate);
      await audit(ctx, {
        action: "salary.changed",
        entityType: "employee",
        entityId: e.id,
        summary: `Pay rate for ${displayName(e)} effective ${input.effectiveFrom}`,
        before: previous ? { amount: previous.amount, basis: previous.basis, payType: previous.payType, payFrequency: previous.payFrequency } : null,
        after: { amount: input.amount, basis: input.basis, payType: input.payType, payFrequency: input.payFrequency },
        reason: input.reason,
      });
      return rate;
    },
  }),

  "compensation.deleteRate": mutation({
    input: z.object({ id: idSchema, reason: nonEmpty(200) }),
    permission: "salary.edit",
    handler: async (ctx, { id, reason }) => {
      const rate = await ctx.repo.payRates.get(ctx.actor.companyId, id);
      if (!rate) throw notFound("Pay rate");
      const e = await getScopedEmployee(ctx, rate.employeeId);
      await guardRetro(ctx, e.id, rate.effectiveFrom);
      const count = await ctx.repo.payRates.count(ctx.actor.companyId, { where: { employeeId: e.id } });
      if (count <= 1) throw conflict("An employee must keep at least one pay rate.");
      await ctx.repo.payRates.remove(ctx.actor.companyId, id);
      await audit(ctx, { action: "salary.rate_deleted", entityType: "employee", entityId: e.id, summary: `Removed scheduled pay rate for ${displayName(e)}`, before: rate, reason });
      return { ok: true };
    },
  }),

  "compensation.addSchedule": mutation({
    input: scheduleInput.extend({ employeeId: idSchema, effectiveFrom: isoDate, reason: nonEmpty(200) }),
    permission: ["salary.edit", "employee.edit"],
    handler: async (ctx, input) => {
      const e = await getScopedEmployee(ctx, input.employeeId);
      if (input.effectiveFrom < e.hireDate) throw validation("The effective date cannot be before the hire date.");
      await guardRetro(ctx, e.id, input.effectiveFrom);
      const now = nowISO(ctx);
      const schedule = {
        id: ctx.ids("sch"),
        companyId: ctx.actor.companyId,
        employeeId: e.id,
        effectiveFrom: input.effectiveFrom,
        workDays: [...new Set(input.workDays)].sort(),
        hoursPerDay: input.hoursPerDay,
        reason: input.reason,
        createdBy: ctx.actor.userId,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.repo.schedules.insert(schedule);
      await audit(ctx, { action: "schedule.changed", entityType: "employee", entityId: e.id, summary: `Work schedule for ${displayName(e)} effective ${input.effectiveFrom}`, after: { workDays: schedule.workDays, hoursPerDay: schedule.hoursPerDay }, reason: input.reason });
      return schedule;
    },
  }),

  "compensation.savePayItem": mutation({
    input: z.object({
      id: idSchema.optional(),
      employeeId: idSchema,
      kind: z.enum(["earning", "deduction"]),
      category: z.enum(["allowance", "commission", "bonus", "other", "pension", "health", "union", "garnishment"]),
      label: nonEmpty(100),
      method: z.enum(["fixed", "percent_of_base"]),
      amount: money,
      taxable: z.boolean(),
      pretax: z.boolean(),
      startDate: isoDate,
      endDate: isoDate.nullable(),
      active: z.boolean(),
    }),
    permission: "salary.edit",
    handler: async (ctx, input) => {
      const e = await getScopedEmployee(ctx, input.employeeId);
      if (input.method === "percent_of_base" && input.amount > 1) throw validation("Enter percentages as a fraction, e.g. 0.05 for 5%.");
      if (input.endDate && input.endDate < input.startDate) throw validation("End date must be on or after the start date.");
      const now = nowISO(ctx);
      const data = { ...input, taxable: input.kind === "earning" ? input.taxable : false, pretax: input.kind === "deduction" ? input.pretax : false };
      if (input.id) {
        const before = await ctx.repo.payItems.get(ctx.actor.companyId, input.id);
        if (!before || before.employeeId !== e.id) throw notFound("Pay item");
        const updated = await ctx.repo.payItems.update(ctx.actor.companyId, input.id, { ...data, updatedAt: now });
        await audit(ctx, { action: input.kind === "deduction" ? "deduction.changed" : "pay_item.changed", entityType: "employee", entityId: e.id, summary: `Updated recurring ${input.kind} "${input.label}" for ${displayName(e)}`, before, after: updated });
        return updated;
      }
      const item: PayItem = { ...data, id: ctx.ids("item"), companyId: ctx.actor.companyId, createdAt: now, updatedAt: now };
      await ctx.repo.payItems.insert(item);
      await audit(ctx, { action: input.kind === "deduction" ? "deduction.created" : "pay_item.created", entityType: "employee", entityId: e.id, summary: `Added recurring ${input.kind} "${input.label}" for ${displayName(e)}`, after: item });
      return item;
    },
  }),

  "compensation.deletePayItem": mutation({
    input: z.object({ id: idSchema }),
    permission: "salary.edit",
    handler: async (ctx, { id }) => {
      const item = await ctx.repo.payItems.get(ctx.actor.companyId, id);
      if (!item) throw notFound("Pay item");
      const e = await getScopedEmployee(ctx, item.employeeId);
      const used = (await finalizedResults(ctx, { employeeId: e.id })).some((r) => r.lines.some((l) => l.sourceRef === id));
      if (used) {
        await ctx.repo.payItems.update(ctx.actor.companyId, id, { active: false, endDate: await companyToday(ctx), updatedAt: nowISO(ctx) });
        await audit(ctx, { action: "pay_item.ended", entityType: "employee", entityId: e.id, summary: `Ended recurring ${item.kind} "${item.label}" (kept for payroll history)` });
        return { ok: true, ended: true };
      }
      await ctx.repo.payItems.remove(ctx.actor.companyId, id);
      await audit(ctx, { action: "pay_item.deleted", entityType: "employee", entityId: e.id, summary: `Deleted recurring ${item.kind} "${item.label}"`, before: item });
      return { ok: true, ended: false };
    },
  }),

  "loans.list": query({
    input: z.object({ status: z.enum(["active", "paid", "cancelled"]).optional() }),
    permission: "salary.view",
    handler: async (ctx, input) => {
      const [loans, results, employees, deps] = await Promise.all([
        ctx.repo.loans.list(ctx.actor.companyId, { where: { status: input.status } }),
        finalizedResults(ctx),
        ctx.repo.employees.list(ctx.actor.companyId, { where: scopeWhere(ctx.actor) }),
        departmentNames(ctx),
      ]);
      const emp = new Map(employees.map((e) => [e.id, e]));
      return loans
        .filter((l) => emp.has(l.employeeId))
        .map((l) => {
          const e = emp.get(l.employeeId)!;
          return { ...l, ...loanOutstanding(l, results), employeeName: displayName(e), employeeCode: e.employeeCode, departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "") : "" };
        });
    },
  }),

  "loans.save": mutation({
    input: z.object({
      id: idSchema.optional(),
      employeeId: idSchema,
      type: z.enum(["loan", "advance"]),
      reference: z.string().trim().max(40).default(""),
      principal: money.positive(),
      installment: money.positive(),
      issuedDate: isoDate,
      startDate: isoDate,
      status: z.enum(["active", "paid", "cancelled"]).default("active"),
      note: optionalText(500),
    }),
    permission: "salary.edit",
    feature: "payroll",
    handler: async (ctx, input) => {
      const e = await getScopedEmployee(ctx, input.employeeId);
      if (input.installment > input.principal) throw validation("The installment cannot exceed the principal.");
      if (input.startDate < input.issuedDate) throw validation("Repayments cannot start before the issue date.");
      const now = nowISO(ctx);
      if (input.id) {
        const before = await ctx.repo.loans.get(ctx.actor.companyId, input.id);
        if (!before || before.employeeId !== e.id) throw notFound("Loan");
        const results = await finalizedResults(ctx, { employeeId: e.id });
        const { repaid } = loanOutstanding(before, results);
        if (input.principal < repaid) throw validation(`Principal cannot be less than the amount already repaid (${repaid}).`);
        const updated = await ctx.repo.loans.update(ctx.actor.companyId, input.id, { ...input, reference: input.reference || before.reference, updatedAt: now });
        await audit(ctx, { action: "loan.updated", entityType: "loan", entityId: input.id, summary: `Updated ${input.type} ${updated.reference} for ${displayName(e)}`, before, after: updated });
        return updated;
      }
      const count = await ctx.repo.loans.count(ctx.actor.companyId);
      const loan: Loan = {
        ...input,
        id: ctx.ids("loan"),
        companyId: ctx.actor.companyId,
        reference: input.reference || `${input.type === "loan" ? "LN" : "ADV"}-${String(count + 1).padStart(4, "0")}`,
        manualRepayments: [],
        createdAt: now,
        updatedAt: now,
      };
      await ctx.repo.loans.insert(loan);
      await audit(ctx, { action: "loan.created", entityType: "loan", entityId: loan.id, summary: `Issued ${loan.type} ${loan.reference} of ${loan.principal} to ${displayName(e)}`, after: loan });
      return loan;
    },
  }),

  "loans.addRepayment": mutation({
    input: z.object({ id: idSchema, date: isoDate, amount: money.positive(), note: nonEmpty(200) }),
    permission: "salary.edit",
    handler: async (ctx, input) => {
      const loan = await ctx.repo.loans.get(ctx.actor.companyId, input.id);
      if (!loan) throw notFound("Loan");
      const e = await getScopedEmployee(ctx, loan.employeeId);
      const results = await finalizedResults(ctx, { employeeId: e.id });
      const { outstanding } = loanOutstanding(loan, results);
      if (input.amount > outstanding) throw validation(`The repayment exceeds the outstanding balance (${outstanding}).`);
      const manualRepayments = [...loan.manualRepayments, { date: input.date, amount: input.amount, note: input.note, payrollResultId: null }];
      const status = Math.abs(outstanding - input.amount) < 0.005 ? "paid" : loan.status;
      await ctx.repo.loans.update(ctx.actor.companyId, loan.id, { manualRepayments, status, updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "loan.repayment", entityType: "loan", entityId: loan.id, summary: `Recorded manual repayment of ${input.amount} on ${loan.reference}`, reason: input.note });
      return { ok: true };
    },
  }),
};
