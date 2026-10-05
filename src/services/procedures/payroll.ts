import { z } from "zod";
import type { PayrollHistoryEntry, PayrollInput, PayrollRun, PayrollStatus } from "@/domain/types";
import { audit, companyToday, idSchema, isoDate, mutation, nonEmpty, nowISO, optionalText, query, signedMoney, type Ctx } from "@/services/core";
import { assertEditableRun, displayName, finalizedResults, getCompany, FINAL_STATUSES } from "@/services/helpers";
import { calculateRun, eligibleEmployees, previousRegularRun } from "@/services/payroll-runner";
import { hasPermission } from "@/services/authz";
import { isAlignedPeriod, nextPeriod, periodContaining, periodLabel } from "@/domain/payroll/calendar";
import { preflightSummary } from "@/domain/payroll/preflight";
import { reviewColumns } from "@/domain/payroll/engine";
import { FREQUENCY_LABELS } from "@/domain/payroll/rates";
import { formatDate, yearOf } from "@/lib/dates";
import { formatMoney, money, sum } from "@/lib/money";
import { conflict, forbidden, invalidState, notFound, validation } from "@/lib/errors";

const frequency = z.enum(["weekly", "biweekly", "semi_monthly", "monthly"]);

async function loadRun(ctx: Ctx, id: string): Promise<PayrollRun> {
  const run = await ctx.repo.payrollRuns.get(ctx.actor.companyId, id);
  if (!run) throw notFound("Payroll run");
  return run;
}

function historyEntry(ctx: Ctx, status: PayrollHistoryEntry["status"], note?: string): PayrollHistoryEntry {
  return { status, at: nowISO(ctx), by: ctx.actor.userId, byName: ctx.actor.name, note };
}

async function transition(ctx: Ctx, run: PayrollRun, to: PayrollStatus, note?: string, extra: Partial<PayrollRun> = {}) {
  const updated = await ctx.repo.payrollRuns.update(ctx.actor.companyId, run.id, {
    ...extra,
    status: to,
    history: [...run.history, historyEntry(ctx, to, note)],
    updatedAt: nowISO(ctx),
  });
  await audit(ctx, {
    action: `payroll.${to}`,
    entityType: "payroll_run",
    entityId: run.id,
    summary: `${run.name}: ${run.status} → ${to}`,
    before: { status: run.status },
    after: { status: to, totals: updated.totals },
    reason: note ?? null,
  });
  return updated;
}

function markStale(run: PayrollRun): Partial<PayrollRun> {
  return run.status === "draft" ? {} : { stale: true, status: "calculated" };
}

const inputSchema = z.object({
  id: idSchema.optional(),
  employeeId: idSchema,
  kind: z.enum(["earning", "deduction"]),
  category: z.enum(["overtime", "allowance", "commission", "bonus", "adjustment", "other", "pension", "health", "union", "garnishment", "advance"]),
  label: nonEmpty(100),
  amount: signedMoney.nullable().default(null),
  hours: z.number().min(-200).max(200).nullable().default(null),
  taxable: z.boolean().default(true),
  pretax: z.boolean().default(false),
  note: optionalText(300),
});

export const payrollProcedures = {
  "payroll.runs.list": query({
    input: z.object({ year: z.number().int().optional(), status: z.array(z.enum(["draft", "calculated", "review", "approved", "finalized", "locked"])).optional() }),
    permission: "payroll.view",
    handler: async (ctx, input) => {
      const runs = await ctx.repo.payrollRuns.list(ctx.actor.companyId, {
        where: { status: input.status?.length ? input.status : undefined },
        range: input.year ? { field: "payDate", gte: `${input.year}-01-01`, lte: `${input.year}-12-31` } : undefined,
        orderBy: [{ field: "payDate", dir: "desc" }, { field: "createdAt", dir: "desc" }],
      });
      return runs.map(({ inputs, preflight, ...r }) => ({
        ...r,
        inputCount: inputs.length,
        preflight: preflightSummary(preflight.issues, preflight.acknowledged),
      }));
    },
  }),

  "payroll.runs.get": query({
    input: z.object({ id: idSchema }),
    permission: "payroll.view",
    handler: async (ctx, { id }) => {
      const run = await loadRun(ctx, id);
      const [results, company, employees] = await Promise.all([
        ctx.repo.payrollResults.list(ctx.actor.companyId, { where: { runId: id } }),
        getCompany(ctx),
        ctx.repo.employees.list(ctx.actor.companyId, { where: { id: run.employeeIds } }),
      ]);
      const prev = run.type === "regular" ? await previousRegularRun(ctx, run) : null;
      const prevResults = prev ? await ctx.repo.payrollResults.list(ctx.actor.companyId, { where: { runId: prev.id } }) : [];
      const prevByEmp = new Map(prevResults.map((r) => [r.employeeId, r]));
      const correctsRun = run.correctsRunId ? await ctx.repo.payrollRuns.get(ctx.actor.companyId, run.correctsRunId) : null;
      const corrections = await ctx.repo.payrollRuns.list(ctx.actor.companyId, { where: { correctsRunId: id } });
      const empName = new Map(employees.map((e) => [e.id, displayName(e)]));
      return {
        run,
        results: results
          .map((r) => ({ ...r, columns: reviewColumns(r), previousNet: prevByEmp.get(r.employeeId)?.totals.net ?? null, previousGross: prevByEmp.get(r.employeeId)?.totals.gross ?? null }))
          .sort((a, b) => a.employee.name.localeCompare(b.employee.name)),
        employees: employees.map((e) => ({ id: e.id, name: displayName(e), code: e.employeeCode, status: e.status })),
        employeeNames: Object.fromEntries(empName),
        previous: prev ? { id: prev.id, name: prev.name, totals: prev.totals } : null,
        correctsRun: correctsRun ? { id: correctsRun.id, name: correctsRun.name } : null,
        corrections: corrections.map((c) => ({ id: c.id, name: c.name, status: c.status, totals: c.totals })),
        preflight: preflightSummary(run.preflight.issues, run.preflight.acknowledged),
        currency: company.currency,
        settings: company.payrollSettings,
        mode: ctx.mode,
      };
    },
  }),

  "payroll.runs.suggest": query({
    input: z.object({ frequency }),
    permission: "payroll.create",
    handler: async (ctx, input) => {
      const company = await getCompany(ctx);
      const calendar = company.payCalendars.find((c) => c.frequency === input.frequency) ?? { frequency: input.frequency, anchorDate: "2026-01-05", payDateOffsetDays: 3, active: true };
      const runs = await ctx.repo.payrollRuns.list(ctx.actor.companyId, { where: { type: "regular", payFrequency: input.frequency }, orderBy: [{ field: "periodEnd", dir: "desc" }], limit: 1 });
      const today = await companyToday(ctx);
      const period = runs[0] ? nextPeriod(calendar, { end: runs[0].periodEnd }) : periodContaining(calendar, today);
      const eligible = await eligibleEmployees(ctx, input.frequency, period.start, period.end);
      return { ...period, name: `${FREQUENCY_LABELS[input.frequency]} payroll · ${periodLabel(input.frequency, period.start, period.end)}`, eligibleCount: eligible.length, calendars: company.payCalendars };
    },
  }),

  "payroll.runs.create": mutation({
    input: z.object({
      type: z.enum(["regular", "off_cycle", "correction"]),
      payFrequency: frequency,
      periodStart: isoDate,
      periodEnd: isoDate,
      payDate: isoDate,
      name: z.string().trim().max(120).optional(),
      employeeIds: z.array(idSchema).optional(),
      correctsRunId: idSchema.optional(),
      correctionReason: z.string().trim().max(500).optional(),
    }),
    permission: "payroll.create",
    feature: "payroll",
    handler: async (ctx, input) => {
      const company = await getCompany(ctx);
      if (input.periodEnd < input.periodStart) throw validation("Period end must be after period start.");
      let periodStart = input.periodStart;
      let periodEnd = input.periodEnd;
      let payFrequency = input.payFrequency;
      let employeeIds = input.employeeIds;
      let name = input.name;
      if (input.type === "regular") {
        const calendar = company.payCalendars.find((c) => c.frequency === input.payFrequency);
        if (calendar && !isAlignedPeriod(calendar, input.periodStart, input.periodEnd)) {
          throw validation(`The period does not match the ${FREQUENCY_LABELS[input.payFrequency].toLowerCase()} pay calendar.`);
        }
      }
      if (input.type === "correction") {
        if (!hasPermission(ctx.actor, "payroll.correct")) throw forbidden("You need the payroll correction permission.");
        if (!input.correctsRunId) throw validation("Choose the payroll run to correct.");
        if (!input.correctionReason) throw validation("A reason is required for a correction.");
        const target = await loadRun(ctx, input.correctsRunId);
        if (!FINAL_STATUSES.includes(target.status)) throw invalidState("Only finalized or locked payrolls can be corrected. Reopen or edit draft payrolls directly.");
        periodStart = target.periodStart;
        periodEnd = target.periodEnd;
        payFrequency = target.payFrequency;
        employeeIds = employeeIds?.length ? employeeIds.filter((id) => target.employeeIds.includes(id)) : [];
        name = name || `Correction · ${target.name}`;
      }
      if (!employeeIds) {
        employeeIds = input.type === "regular" ? (await eligibleEmployees(ctx, payFrequency, periodStart, periodEnd)).map((e) => e.id) : [];
      }
      const now = nowISO(ctx);
      const run: PayrollRun = {
        id: ctx.ids("run"),
        companyId: ctx.actor.companyId,
        type: input.type,
        payFrequency,
        periodStart,
        periodEnd,
        payDate: input.payDate,
        status: "draft",
        name: name || `${input.type === "off_cycle" ? "Off-cycle" : FREQUENCY_LABELS[payFrequency]} payroll · ${periodLabel(payFrequency, periodStart, periodEnd)}`,
        correctsRunId: input.correctsRunId ?? null,
        correctionReason: input.correctionReason ?? null,
        employeeIds,
        inputs: [],
        totals: null,
        preflight: { issues: [], ranAt: null, acknowledged: [] },
        calculationVersion: null,
        stale: false,
        history: [historyEntry(ctx, "created", input.correctionReason)],
        createdBy: ctx.actor.userId,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.repo.payrollRuns.insert(run);
      await audit(ctx, {
        action: input.type === "correction" ? "payroll.correction_created" : "payroll.created",
        entityType: "payroll_run",
        entityId: run.id,
        summary: `Created ${run.name} with ${employeeIds.length} employee(s)`,
        reason: input.correctionReason ?? null,
      });
      return run;
    },
  }),

  "payroll.runs.setEmployees": mutation({
    input: z.object({ runId: idSchema, employeeIds: z.array(idSchema) }),
    permission: "payroll.create",
    handler: async (ctx, input) => {
      const run = await loadRun(ctx, input.runId);
      assertEditableRun(run);
      const valid = await ctx.repo.employees.list(ctx.actor.companyId, { where: { id: input.employeeIds } });
      const employeeIds = valid.map((e) => e.id);
      const inputs = run.inputs.filter((i) => employeeIds.includes(i.employeeId));
      const updated = await ctx.repo.payrollRuns.update(ctx.actor.companyId, run.id, { employeeIds, inputs, ...markStale(run), updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "payroll.employees_changed", entityType: "payroll_run", entityId: run.id, summary: `${run.name}: ${run.employeeIds.length} → ${employeeIds.length} employees` });
      return updated;
    },
  }),

  "payroll.inputs.save": mutation({
    input: z.object({ runId: idSchema, input: inputSchema }),
    permission: "payroll.create",
    handler: async (ctx, { runId, input }) => {
      const run = await loadRun(ctx, runId);
      assertEditableRun(run);
      if (!run.employeeIds.includes(input.employeeId)) throw validation("That employee is not in this payroll.");
      if (input.category === "overtime" && input.kind === "earning" ? !input.hours : input.amount === null) {
        throw validation(input.category === "overtime" ? "Enter overtime hours." : "Enter an amount.");
      }
      if (run.type !== "correction" && input.amount !== null && input.amount < 0) throw validation("Use a deduction for negative amounts (corrections may use negative adjustments).");
      const entry: PayrollInput = { ...input, id: input.id ?? ctx.ids("inp"), amount: input.amount, hours: input.hours };
      const inputs = input.id ? run.inputs.map((i) => (i.id === input.id ? entry : i)) : [...run.inputs, entry];
      const updated = await ctx.repo.payrollRuns.update(ctx.actor.companyId, run.id, { inputs, ...markStale(run), updatedAt: nowISO(ctx) });
      const emp = await ctx.repo.employees.get(ctx.actor.companyId, input.employeeId);
      await audit(ctx, {
        action: input.id ? "payroll.input_updated" : "payroll.input_added",
        entityType: "payroll_run",
        entityId: run.id,
        summary: `${input.kind === "deduction" ? "Deduction" : "Earning"} "${input.label}" ${input.amount !== null ? input.amount : `${input.hours} h`} for ${emp ? displayName(emp) : input.employeeId}`,
        after: entry,
      });
      return updated;
    },
  }),

  "payroll.inputs.delete": mutation({
    input: z.object({ runId: idSchema, inputId: idSchema }),
    permission: "payroll.create",
    handler: async (ctx, input) => {
      const run = await loadRun(ctx, input.runId);
      assertEditableRun(run);
      const existing = run.inputs.find((i) => i.id === input.inputId);
      if (!existing) throw notFound("Payroll input");
      const updated = await ctx.repo.payrollRuns.update(ctx.actor.companyId, run.id, { inputs: run.inputs.filter((i) => i.id !== input.inputId), ...markStale(run), updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "payroll.input_removed", entityType: "payroll_run", entityId: run.id, summary: `Removed "${existing.label}"`, before: existing });
      return updated;
    },
  }),

  "payroll.calculate": mutation({
    input: z.object({ runId: idSchema }),
    permission: "payroll.calculate",
    feature: "payroll",
    handler: async (ctx, { runId }) => {
      const run = await loadRun(ctx, runId);
      assertEditableRun(run);
      if (run.type === "historical") throw invalidState("Historical payroll cannot be recalculated.");
      if (run.employeeIds.length === 0) throw validation("Add at least one employee before calculating.");
      const company = await getCompany(ctx);
      const { run: next, results } = await calculateRun(ctx, run, company);
      await ctx.repo.transaction(async (repo) => {
        const old = await repo.payrollResults.list(ctx.actor.companyId, { where: { runId } });
        for (const r of old) await repo.payrollResults.remove(ctx.actor.companyId, r.id);
        await repo.payrollResults.insertMany(results);
        await repo.payrollRuns.update(ctx.actor.companyId, runId, {
          ...next,
          status: run.status === "review" ? "review" : "calculated",
          history: [...run.history, historyEntry(ctx, "calculated")],
        });
      });
      const t = next.totals!;
      await audit(ctx, {
        action: "payroll.calculated",
        entityType: "payroll_run",
        entityId: runId,
        summary: `Calculated ${run.name}: ${t.employees} employees, gross ${formatMoney(t.gross, company.currency)}, net ${formatMoney(t.net, company.currency)}`,
        after: t,
      });
      return { totals: t, preflight: preflightSummary(next.preflight.issues, next.preflight.acknowledged) };
    },
  }),

  "payroll.submitForReview": mutation({
    input: z.object({ runId: idSchema }),
    permission: "payroll.calculate",
    handler: async (ctx, { runId }) => {
      const run = await loadRun(ctx, runId);
      if (run.status !== "calculated") throw invalidState("Calculate the payroll before submitting it for review.");
      if (run.stale) throw invalidState("Inputs changed after the last calculation. Recalculate first.");
      return transition(ctx, run, "review");
    },
  }),

  "payroll.acknowledge": mutation({
    input: z.object({ runId: idSchema, issueIds: z.array(z.string()).min(1), acknowledged: z.boolean() }),
    permission: ["payroll.approve", "payroll.calculate"],
    handler: async (ctx, input) => {
      const run = await loadRun(ctx, input.runId);
      assertEditableRun(run);
      const warnings = new Set(run.preflight.issues.filter((i) => i.severity === "warning").map((i) => i.id));
      const set = new Set(run.preflight.acknowledged);
      for (const id of input.issueIds) {
        if (!warnings.has(id)) continue;
        if (input.acknowledged) set.add(id);
        else set.delete(id);
      }
      await ctx.repo.payrollRuns.update(ctx.actor.companyId, run.id, { preflight: { ...run.preflight, acknowledged: [...set] }, updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "payroll.warnings_acknowledged", entityType: "payroll_run", entityId: run.id, summary: `${input.acknowledged ? "Acknowledged" : "Un-acknowledged"} ${input.issueIds.length} warning(s)` });
      return { ok: true };
    },
  }),

  "payroll.approve": mutation({
    input: z.object({ runId: idSchema, note: optionalText(300) }),
    permission: "payroll.approve",
    feature: "payroll",
    handler: async (ctx, input) => {
      const run = await loadRun(ctx, input.runId);
      if (run.status !== "review") throw invalidState("Only payrolls in review can be approved.");
      if (run.stale) throw invalidState("Inputs changed after the last calculation. Recalculate first.");
      const s = preflightSummary(run.preflight.issues, run.preflight.acknowledged);
      if (s.errors > 0) throw invalidState(`${s.errors} pre-flight error(s) must be resolved before approval.`);
      if (s.unacknowledged > 0) throw invalidState(`${s.unacknowledged} warning(s) need acknowledgement before approval.`);
      return transition(ctx, run, "approved", input.note || undefined);
    },
  }),

  "payroll.finalize": mutation({
    input: z.object({ runId: idSchema }),
    permission: "payroll.finalize",
    feature: "payroll",
    handler: async (ctx, { runId }) => {
      const run = await loadRun(ctx, runId);
      if (run.status !== "approved") throw invalidState("Only approved payrolls can be finalized.");
      if (ctx.mode === "production") {
        const results = await ctx.repo.payrollResults.list(ctx.actor.companyId, { where: { runId } });
        const unapproved = new Set(results.flatMap((r) => r.statutory.filter((s) => s.status !== "approved").map((s) => s.name)));
        if (unapproved.size) throw invalidState(`Statutory rules must be approved before finalizing: ${[...unapproved].join(", ")}.`);
      }
      const finalized = await transition(ctx, run, "finalized");
      // Mark loans fully repaid by this payroll.
      const results = await ctx.repo.payrollResults.list(ctx.actor.companyId, { where: { runId } });
      const loanIds = new Set(results.flatMap((r) => r.lines.filter((l) => l.source === "loan" && l.sourceRef).map((l) => l.sourceRef!)));
      if (loanIds.size) {
        const all = await finalizedResults(ctx);
        for (const id of loanIds) {
          const loan = await ctx.repo.loans.get(ctx.actor.companyId, id);
          if (!loan || loan.status !== "active") continue;
          const repaid = sum([
            ...all.flatMap((r) => r.lines.filter((l) => l.source === "loan" && l.sourceRef === id).map((l) => l.amount)),
            ...loan.manualRepayments.map((m) => m.amount),
          ]);
          if (money(repaid) >= loan.principal - 0.005) await ctx.repo.loans.update(ctx.actor.companyId, id, { status: "paid", updatedAt: nowISO(ctx) });
        }
      }
      return finalized;
    },
  }),

  "payroll.lock": mutation({
    input: z.object({ runId: idSchema }),
    permission: "payroll.lock",
    handler: async (ctx, { runId }) => {
      const run = await loadRun(ctx, runId);
      if (run.status !== "finalized") throw invalidState("Only finalized payrolls can be locked.");
      return transition(ctx, run, "locked");
    },
  }),

  "payroll.reopen": mutation({
    input: z.object({ runId: idSchema, reason: nonEmpty(500) }),
    permission: "payroll.reopen",
    handler: async (ctx, input) => {
      const run = await loadRun(ctx, input.runId);
      if (!["approved", "finalized", "locked"].includes(run.status)) throw invalidState("Only approved, finalized or locked payrolls can be reopened.");
      if (run.type === "historical") throw invalidState("Imported historical payroll cannot be reopened.");
      const corrections = await ctx.repo.payrollRuns.count(ctx.actor.companyId, { where: { correctsRunId: run.id } });
      if (corrections > 0) throw conflict("This payroll has correction runs. Further changes must also be made as corrections.");
      const later = await ctx.repo.payrollRuns.list(ctx.actor.companyId, { where: { payFrequency: run.payFrequency, status: FINAL_STATUSES, type: "regular" }, range: { field: "periodStart", gte: run.periodEnd } });
      if (later.some((r) => r.id !== run.id && r.periodStart > run.periodEnd)) {
        throw conflict(`A later payroll (${later[0].name}) is already finalized. Use a correction run instead.`);
      }
      const reopened = await ctx.repo.payrollRuns.update(ctx.actor.companyId, run.id, {
        status: "review",
        stale: true,
        history: [...run.history, historyEntry(ctx, "reopened", input.reason)],
        updatedAt: nowISO(ctx),
      });
      await audit(ctx, { action: "payroll.reopened", entityType: "payroll_run", entityId: run.id, summary: `Reopened ${run.name} (was ${run.status})`, before: { status: run.status }, after: { status: "review" }, reason: input.reason });
      return reopened;
    },
  }),

  "payroll.runs.delete": mutation({
    input: z.object({ runId: idSchema, reason: nonEmpty(300) }),
    permission: "payroll.create",
    handler: async (ctx, input) => {
      const run = await loadRun(ctx, input.runId);
      if (!["draft", "calculated", "review"].includes(run.status)) throw invalidState("Approved, finalized and locked payrolls cannot be deleted.");
      await ctx.repo.transaction(async (repo) => {
        const results = await repo.payrollResults.list(ctx.actor.companyId, { where: { runId: run.id } });
        for (const r of results) await repo.payrollResults.remove(ctx.actor.companyId, r.id);
        await repo.payrollRuns.remove(ctx.actor.companyId, run.id);
      });
      await audit(ctx, { action: "payroll.deleted", entityType: "payroll_run", entityId: run.id, summary: `Deleted ${run.name} (${run.status})`, reason: input.reason });
      return { ok: true };
    },
  }),

  "payroll.payslips": query({
    input: z.object({ runId: idSchema, employeeIds: z.array(idSchema).optional() }),
    permission: "payroll.view",
    handler: async (ctx, input) => {
      const run = await loadRun(ctx, input.runId);
      if (!run.totals) throw invalidState("Calculate the payroll first.");
      const company = await getCompany(ctx);
      const results = (await ctx.repo.payrollResults.list(ctx.actor.companyId, { where: { runId: run.id } })).filter((r) => !input.employeeIds || input.employeeIds.includes(r.employeeId));
      const year = yearOf(run.payDate);
      const prior = await finalizedResults(ctx, { year });
      return {
        company: { legalName: company.legalName, tradingName: company.tradingName, address: company.address, currency: company.currency, employerIds: company.employerIds },
        run: { id: run.id, name: run.name, status: run.status, type: run.type, periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate },
        payslips: results.map((r) => ({ result: r, ytd: ytdFor(prior, r.employeeId, run.payDate, r, FINAL_STATUSES.includes(run.status)) })),
      };
    },
  }),

  "payroll.ytd": query({
    input: z.object({ employeeId: idSchema.optional(), year: z.number().int() }),
    permission: ["payroll.view", "self.view"],
    handler: async (ctx, input) => {
      const employeeId = input.employeeId ?? ctx.actor.employeeId;
      if (!employeeId) return null;
      if (!hasPermission(ctx.actor, "payroll.view") && employeeId !== ctx.actor.employeeId) throw notFound("Employee");
      const results = await finalizedResults(ctx, { employeeId, year: input.year });
      return summarizeYtd(results);
    },
  }),
};

type ResultLike = { employeeId: string; payDate: string; totals: { gross: number; net: number; employeeStatutory: number; employerStatutory: number; preTaxDeductions: number; postTaxDeductions: number }; statutory: { code: string; name: string; employeeAmount: number; employerAmount: number }[] };

export function summarizeYtd(results: ResultLike[]) {
  const s = (f: (r: ResultLike) => number) => money(sum(results.map(f)));
  const statutory: Record<string, { name: string; employee: number; employer: number }> = {};
  for (const r of results) {
    for (const st of r.statutory) {
      const cur = statutory[st.code] ?? { name: st.name, employee: 0, employer: 0 };
      cur.employee = money(sum([cur.employee, st.employeeAmount]));
      cur.employer = money(sum([cur.employer, st.employerAmount]));
      statutory[st.code] = cur;
    }
  }
  return {
    payments: results.length,
    gross: s((r) => r.totals.gross),
    net: s((r) => r.totals.net),
    employeeStatutory: s((r) => r.totals.employeeStatutory),
    employerStatutory: s((r) => r.totals.employerStatutory),
    deductions: s((r) => r.totals.preTaxDeductions + r.totals.postTaxDeductions),
    statutory,
  };
}

/** YTD as at this payslip: finalized results up to and including this pay date. */
export function ytdFor(prior: ResultLike[], employeeId: string, payDate: string, current: ResultLike & { id?: string }, currentIsFinal: boolean) {
  const rows = prior.filter((r) => r.employeeId === employeeId && r.payDate <= payDate && (r as { id?: string }).id !== current.id);
  return summarizeYtd(currentIsFinal || !current ? [...rows, current] : [...rows, current]);
}

export { formatDate };
