import { z } from "zod";
import type { LeaveLedgerEntry, LeavePolicy, LeaveRequest, LeaveType } from "@/domain/types";
import { audit, companyToday, idSchema, isoDate, mutation, nonEmpty, nowISO, optionalText, query } from "@/services/core";
import { departmentNames, displayName, finalizedRuns, getCompany, getScopedEmployee, scopeWhere } from "@/services/helpers";
import { assertEmployeeScope, canAccessEmployee, hasPermission } from "@/services/authz";
import { computeBalance, leaveQuantity, planCarryForwardExpiry, planYearEnd, policyRule, type LeaveBalance } from "@/domain/leave/balances";
import { yearOf, formatDate } from "@/lib/dates";
import { conflict, forbidden, invalidState, notFound, validation } from "@/lib/errors";

async function ledgerFor(ctx: Parameters<typeof getCompany>[0], employeeId: string) {
  return ctx.repo.leaveLedger.list(ctx.actor.companyId, { where: { employeeId } });
}

async function balancesFor(ctx: Parameters<typeof getCompany>[0], employeeId: string, asOf: string): Promise<(LeaveBalance & { leaveTypeName: string; color: string; tracksBalance: boolean; paid: boolean })[]> {
  const e = await getScopedEmployee(ctx, employeeId);
  const [types, policy, ledger, pending] = await Promise.all([
    ctx.repo.leaveTypes.list(ctx.actor.companyId, { where: { active: true } }),
    e.leavePolicyId ? ctx.repo.leavePolicies.get(ctx.actor.companyId, e.leavePolicyId) : Promise.resolve(null),
    ledgerFor(ctx, employeeId),
    ctx.repo.leaveRequests.list(ctx.actor.companyId, { where: { employeeId, status: "pending" } }),
  ]);
  return types.map((t) => ({
    ...computeBalance(t, policyRule(policy, t.id), ledger, pending, asOf, e.hireDate),
    leaveTypeName: t.name,
    color: t.color,
    tracksBalance: t.tracksBalance,
    paid: t.paid,
  }));
}

/** Can the actor act on leave for this employee (as an approver/administrator)? */
function canManageLeaveFor(ctx: Parameters<typeof getCompany>[0], employeeId: string) {
  return (hasPermission(ctx.actor, "leave.approve") || hasPermission(ctx.actor, "leave.adjust")) && canAccessEmployee(ctx.actor, employeeId) && ctx.actor.employeeId !== employeeId;
}

async function payrollLockWarning(ctx: Parameters<typeof getCompany>[0], req: Pick<LeaveRequest, "employeeId" | "startDate" | "endDate">, type: LeaveType): Promise<string | null> {
  if (type.paid) return null;
  const runs = await finalizedRuns(ctx);
  const hit = runs.find((r) => r.employeeIds.includes(req.employeeId) && r.type === "regular" && r.periodStart <= req.endDate && r.periodEnd >= req.startDate);
  return hit ? `Part of this unpaid leave falls in a finalized payroll (${formatDate(hit.periodStart)} – ${formatDate(hit.periodEnd)}). Record the deduction with a correction run.` : null;
}

export const leaveProcedures = {
  "leave.types.list": query({
    input: z.object({ includeInactive: z.boolean().default(false) }),
    permission: null,
    handler: async (ctx, input) => ctx.repo.leaveTypes.list(ctx.actor.companyId, { where: input.includeInactive ? {} : { active: true } }),
  }),

  "leave.types.save": mutation({
    input: z.object({
      id: idSchema.optional(),
      code: z.string().trim().min(1).max(12).toUpperCase(),
      name: nonEmpty(60),
      category: z.enum(["vacation", "sick", "unpaid_sick", "unpaid", "other"]),
      paid: z.boolean(),
      unit: z.enum(["days", "hours"]),
      tracksBalance: z.boolean(),
      requiresApproval: z.boolean(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      active: z.boolean(),
    }),
    permission: "leave.configure",
    handler: async (ctx, input) => {
      const now = nowISO(ctx);
      if (input.id) {
        const before = await ctx.repo.leaveTypes.get(ctx.actor.companyId, input.id);
        if (!before) throw notFound("Leave type");
        const used = await ctx.repo.leaveRequests.count(ctx.actor.companyId, { where: { leaveTypeId: input.id, status: "approved" } });
        if (used > 0 && before.paid !== input.paid) throw conflict("Paid/unpaid cannot change after leave of this type has been approved. Create a new leave type instead.");
        const updated = await ctx.repo.leaveTypes.update(ctx.actor.companyId, input.id, { ...input, updatedAt: now });
        await audit(ctx, { action: "leave.type_updated", entityType: "leave_type", entityId: input.id, summary: `Updated leave type ${input.name}`, before, after: updated });
        return updated;
      }
      const type: LeaveType = { ...input, id: ctx.ids("lvt"), companyId: ctx.actor.companyId, createdAt: now, updatedAt: now };
      await ctx.repo.leaveTypes.insert(type);
      await audit(ctx, { action: "leave.type_created", entityType: "leave_type", entityId: type.id, summary: `Created leave type ${type.name}` });
      return type;
    },
  }),

  "leave.policies.list": query({
    input: z.object({}),
    permission: ["leave.view", "leave.configure", "employee.view"],
    handler: async (ctx) => ctx.repo.leavePolicies.list(ctx.actor.companyId),
  }),

  "leave.policies.save": mutation({
    input: z.object({
      id: idSchema.optional(),
      name: nonEmpty(80),
      isDefault: z.boolean(),
      rules: z.array(
        z.object({
          leaveTypeId: idSchema,
          annualEntitlement: z.number().min(0).max(365),
          accrual: z.enum(["upfront", "monthly"]),
          carryForwardMax: z.number().min(0).max(365),
          carryForwardExpiryMonths: z.number().int().min(0).max(12),
        }),
      ),
    }),
    permission: "leave.configure",
    handler: async (ctx, input) => {
      const now = nowISO(ctx);
      if (new Set(input.rules.map((r) => r.leaveTypeId)).size !== input.rules.length) throw validation("Each leave type can appear once per policy.");
      const policies = await ctx.repo.leavePolicies.list(ctx.actor.companyId);
      if (input.isDefault) {
        for (const p of policies) if (p.isDefault && p.id !== input.id) await ctx.repo.leavePolicies.update(ctx.actor.companyId, p.id, { isDefault: false, updatedAt: now });
      }
      if (input.id) {
        const before = policies.find((p) => p.id === input.id);
        if (!before) throw notFound("Leave policy");
        const updated = await ctx.repo.leavePolicies.update(ctx.actor.companyId, input.id, { ...input, updatedAt: now });
        await audit(ctx, { action: "leave.policy_updated", entityType: "leave_policy", entityId: input.id, summary: `Updated leave policy ${input.name}`, before, after: updated });
        return updated;
      }
      const policy: LeavePolicy = { ...input, id: ctx.ids("lvp"), companyId: ctx.actor.companyId, createdAt: now, updatedAt: now };
      await ctx.repo.leavePolicies.insert(policy);
      await audit(ctx, { action: "leave.policy_created", entityType: "leave_policy", entityId: policy.id, summary: `Created leave policy ${policy.name}` });
      return policy;
    },
  }),

  "leave.requests.list": query({
    input: z.object({
      status: z.array(z.enum(["pending", "approved", "rejected", "cancelled"])).optional(),
      employeeId: idSchema.optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      leaveTypeId: idSchema.optional(),
      limit: z.number().int().min(1).max(1000).default(300),
    }),
    permission: ["leave.view", "self.view"],
    handler: async (ctx, input) => {
      const selfOnly = !hasPermission(ctx.actor, "leave.view");
      const employeeFilter = selfOnly ? (ctx.actor.employeeId ? [ctx.actor.employeeId] : []) : (scopeWhere(ctx.actor).id ?? undefined);
      if (input.employeeId) assertEmployeeScope(ctx.actor, input.employeeId);
      const rows = await ctx.repo.leaveRequests.list(ctx.actor.companyId, {
        where: {
          employeeId: input.employeeId ?? employeeFilter,
          status: input.status?.length ? input.status : undefined,
          leaveTypeId: input.leaveTypeId,
        },
        overlaps: input.from && input.to ? { startField: "startDate", endField: "endDate", start: input.from, end: input.to } : undefined,
        limit: input.limit,
      });
      const [employees, types, deps] = await Promise.all([
        ctx.repo.employees.list(ctx.actor.companyId),
        ctx.repo.leaveTypes.list(ctx.actor.companyId),
        departmentNames(ctx),
      ]);
      const users = await ctx.repo.users.listByOrganization(ctx.actor.organizationId);
      const emp = new Map(employees.map((e) => [e.id, e]));
      const typ = new Map(types.map((t) => [t.id, t]));
      const usr = new Map(users.map((u) => [u.id, u.name]));
      return rows.map((r) => {
        const e = emp.get(r.employeeId);
        const t = typ.get(r.leaveTypeId);
        return {
          ...r,
          employeeName: e ? displayName(e) : "—",
          employeeCode: e?.employeeCode ?? "",
          departmentName: e?.departmentId ? (deps.get(e.departmentId) ?? "") : "",
          leaveTypeName: t?.name ?? "—",
          leaveTypeColor: t?.color ?? "#777",
          paid: t?.paid ?? true,
          decidedByName: r.decidedBy ? (usr.get(r.decidedBy) ?? "—") : null,
          canDecide: r.status === "pending" && canManageLeaveFor(ctx, r.employeeId) && hasPermission(ctx.actor, "leave.approve"),
          canCancel: (r.status === "pending" && (r.employeeId === ctx.actor.employeeId || canManageLeaveFor(ctx, r.employeeId))) || (r.status === "approved" && canManageLeaveFor(ctx, r.employeeId)),
        };
      });
    },
  }),

  "leave.requests.create": mutation({
    input: z.object({
      employeeId: idSchema.optional(),
      leaveTypeId: idSchema,
      startDate: isoDate,
      endDate: isoDate,
      hours: z.number().min(0.25).max(24).nullable().default(null),
      reason: optionalText(500),
      approveNow: z.boolean().default(false),
    }),
    permission: ["leave.request", "leave.approve", "leave.adjust"],
    feature: "hr",
    handler: async (ctx, input) => {
      const employeeId = input.employeeId ?? ctx.actor.employeeId;
      if (!employeeId) throw validation("Select an employee.");
      const forSelf = employeeId === ctx.actor.employeeId;
      if (!forSelf && !canManageLeaveFor(ctx, employeeId)) throw forbidden("You cannot record leave for this employee.");
      if (forSelf && !hasPermission(ctx.actor, "leave.request")) throw forbidden();
      const e = await getScopedEmployee(ctx, employeeId);
      if (e.status === "terminated" || e.status === "archived") throw conflict("This employee is no longer employed.");
      if (input.endDate < input.startDate) throw validation("End date must be on or after start date.");
      if (input.hours && input.startDate !== input.endDate) throw validation("Hours can only be entered for a single-day request.");
      if (input.startDate < e.hireDate || (e.terminationDate && input.endDate > e.terminationDate)) throw validation("Leave must fall within the employment period.");
      const type = await ctx.repo.leaveTypes.get(ctx.actor.companyId, input.leaveTypeId);
      if (!type || !type.active) throw validation("Choose an active leave type.");
      const [company, schedules] = await Promise.all([getCompany(ctx), ctx.repo.schedules.list(ctx.actor.companyId, { where: { employeeId } })]);
      const { quantity } = leaveQuantity(input, type, schedules, company.holidays);
      if (quantity <= 0) throw validation("The selected dates contain no working days for this employee.");

      const overlapping = await ctx.repo.leaveRequests.list(ctx.actor.companyId, {
        where: { employeeId, status: ["pending", "approved"] },
        overlaps: { startField: "startDate", endField: "endDate", start: input.startDate, end: input.endDate },
      });
      if (overlapping.length) throw conflict(`This overlaps an existing ${overlapping[0].status} request (${formatDate(overlapping[0].startDate)} – ${formatDate(overlapping[0].endDate)}).`);

      if (type.tracksBalance) {
        const balances = await balancesFor(ctx, employeeId, input.startDate);
        const b = balances.find((x) => x.leaveTypeId === type.id);
        if (b && quantity > b.available - b.pending) {
          throw conflict(`Insufficient ${type.name} balance: ${b.available - b.pending} ${type.unit} available after pending requests, ${quantity} requested.`);
        }
      }

      const autoApprove = !type.requiresApproval || (input.approveNow && !forSelf && hasPermission(ctx.actor, "leave.approve"));
      const now = nowISO(ctx);
      const req: LeaveRequest = {
        id: ctx.ids("lvr"),
        companyId: ctx.actor.companyId,
        employeeId,
        leaveTypeId: type.id,
        startDate: input.startDate,
        endDate: input.endDate,
        hours: input.hours,
        quantity,
        unit: input.hours ? "hours" : type.unit,
        reason: input.reason,
        status: autoApprove ? "approved" : "pending",
        decidedBy: autoApprove ? ctx.actor.userId : null,
        decidedAt: autoApprove ? now : null,
        decisionNote: autoApprove ? "Recorded and approved" : null,
        createdBy: ctx.actor.userId,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.repo.transaction(async (repo) => {
        await repo.leaveRequests.insert(req);
        if (autoApprove && type.tracksBalance) {
          await repo.leaveLedger.insert({ id: ctx.ids("lvl"), companyId: ctx.actor.companyId, employeeId, leaveTypeId: type.id, date: req.startDate, amount: -quantity, kind: "taken", reason: `${type.name} ${formatDate(req.startDate)} – ${formatDate(req.endDate)}`, requestId: req.id, createdBy: ctx.actor.userId, createdAt: now, updatedAt: now });
        }
      });
      await audit(ctx, {
        action: autoApprove ? "leave.recorded" : "leave.requested",
        entityType: "leave_request",
        entityId: req.id,
        summary: `${autoApprove ? "Recorded" : "Requested"} ${quantity} ${req.unit} ${type.name} for ${displayName(e)} (${formatDate(req.startDate)} – ${formatDate(req.endDate)})`,
        after: req,
      });
      return { request: req, warning: autoApprove ? await payrollLockWarning(ctx, req, type) : null };
    },
  }),

  "leave.requests.decide": mutation({
    input: z.object({ id: idSchema, decision: z.enum(["approve", "reject"]), note: optionalText(500) }),
    permission: "leave.approve",
    handler: async (ctx, input) => {
      const req = await ctx.repo.leaveRequests.get(ctx.actor.companyId, input.id);
      if (!req) throw notFound("Leave request");
      assertEmployeeScope(ctx.actor, req.employeeId);
      if (req.employeeId === ctx.actor.employeeId) throw forbidden("You cannot approve your own leave.");
      if (req.status !== "pending") throw invalidState(`This request is already ${req.status}.`);
      if (input.decision === "reject" && !input.note) throw validation("Add a note explaining the rejection.");
      const type = await ctx.repo.leaveTypes.get(ctx.actor.companyId, req.leaveTypeId);
      if (!type) throw notFound("Leave type");
      const e = await getScopedEmployee(ctx, req.employeeId);
      const now = nowISO(ctx);
      if (input.decision === "approve" && type.tracksBalance) {
        const balances = await balancesFor(ctx, req.employeeId, req.startDate);
        const b = balances.find((x) => x.leaveTypeId === type.id);
        if (b && req.quantity > b.available) throw conflict(`Insufficient ${type.name} balance (${b.available} ${type.unit} available).`);
      }
      await ctx.repo.transaction(async (repo) => {
        await repo.leaveRequests.update(ctx.actor.companyId, req.id, {
          status: input.decision === "approve" ? "approved" : "rejected",
          decidedBy: ctx.actor.userId,
          decidedAt: now,
          decisionNote: input.note || null,
          updatedAt: now,
        });
        if (input.decision === "approve" && type.tracksBalance) {
          await repo.leaveLedger.insert({ id: ctx.ids("lvl"), companyId: ctx.actor.companyId, employeeId: req.employeeId, leaveTypeId: type.id, date: req.startDate, amount: -req.quantity, kind: "taken", reason: `${type.name} ${formatDate(req.startDate)} – ${formatDate(req.endDate)}`, requestId: req.id, createdBy: ctx.actor.userId, createdAt: now, updatedAt: now });
        }
      });
      await audit(ctx, {
        action: input.decision === "approve" ? "leave.approved" : "leave.rejected",
        entityType: "leave_request",
        entityId: req.id,
        summary: `${input.decision === "approve" ? "Approved" : "Rejected"} ${type.name} for ${displayName(e)} (${formatDate(req.startDate)} – ${formatDate(req.endDate)})`,
        reason: input.note || null,
      });
      return { ok: true, warning: input.decision === "approve" ? await payrollLockWarning(ctx, req, type) : null };
    },
  }),

  "leave.requests.cancel": mutation({
    input: z.object({ id: idSchema, reason: nonEmpty(300) }),
    permission: ["leave.request", "leave.approve", "leave.adjust"],
    handler: async (ctx, input) => {
      const req = await ctx.repo.leaveRequests.get(ctx.actor.companyId, input.id);
      if (!req) throw notFound("Leave request");
      assertEmployeeScope(ctx.actor, req.employeeId);
      const own = req.employeeId === ctx.actor.employeeId;
      if (req.status === "pending" && !own && !canManageLeaveFor(ctx, req.employeeId)) throw forbidden();
      if (req.status === "approved" && !canManageLeaveFor(ctx, req.employeeId)) throw forbidden("Ask your manager or HR to cancel approved leave.");
      if (req.status !== "pending" && req.status !== "approved") throw invalidState(`This request is already ${req.status}.`);
      const type = await ctx.repo.leaveTypes.get(ctx.actor.companyId, req.leaveTypeId);
      const now = nowISO(ctx);
      if (req.status === "approved" && type && !type.paid) {
        const warning = await payrollLockWarning(ctx, req, type);
        if (warning) throw conflict(`${warning.replace("Record the deduction", "Reverse it")} Cancelling here would not change the finalized payroll.`);
      }
      await ctx.repo.transaction(async (repo) => {
        await repo.leaveRequests.update(ctx.actor.companyId, req.id, { status: "cancelled", decisionNote: input.reason, decidedBy: ctx.actor.userId, decidedAt: now, updatedAt: now });
        if (req.status === "approved" && type?.tracksBalance) {
          await repo.leaveLedger.insert({ id: ctx.ids("lvl"), companyId: ctx.actor.companyId, employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, date: req.startDate, amount: req.quantity, kind: "reversal", reason: `Cancelled: ${input.reason}`, requestId: req.id, createdBy: ctx.actor.userId, createdAt: now, updatedAt: now });
        }
      });
      await audit(ctx, { action: "leave.cancelled", entityType: "leave_request", entityId: req.id, summary: `Cancelled ${req.status} leave request (${formatDate(req.startDate)} – ${formatDate(req.endDate)})`, reason: input.reason });
      return { ok: true };
    },
  }),

  "leave.balances": query({
    input: z.object({ employeeId: idSchema.optional(), asOf: isoDate.optional() }),
    permission: ["leave.view", "self.view"],
    handler: async (ctx, input) => {
      const employeeId = input.employeeId ?? ctx.actor.employeeId;
      if (!employeeId) return [];
      if (!hasPermission(ctx.actor, "leave.view") && employeeId !== ctx.actor.employeeId) throw notFound("Employee");
      return balancesFor(ctx, employeeId, input.asOf ?? (await companyToday(ctx)));
    },
  }),

  "leave.balances.all": query({
    input: z.object({ asOf: isoDate.optional() }),
    permission: "leave.view",
    handler: async (ctx, input) => {
      const asOf = input.asOf ?? (await companyToday(ctx));
      const [employees, types, policies, ledger, pending, deps] = await Promise.all([
        ctx.repo.employees.list(ctx.actor.companyId, { where: { ...scopeWhere(ctx.actor), status: ["active", "on_leave", "onboarding"] } }),
        ctx.repo.leaveTypes.list(ctx.actor.companyId, { where: { active: true } }),
        ctx.repo.leavePolicies.list(ctx.actor.companyId),
        ctx.repo.leaveLedger.list(ctx.actor.companyId, { range: { field: "date", gte: `${asOf.slice(0, 4)}-01-01`, lte: asOf } }),
        ctx.repo.leaveRequests.list(ctx.actor.companyId, { where: { status: "pending" } }),
        departmentNames(ctx),
      ]);
      const pol = new Map(policies.map((p) => [p.id, p]));
      const tracked = types.filter((t) => t.tracksBalance);
      return {
        types: tracked.map((t) => ({ id: t.id, name: t.name, unit: t.unit, color: t.color })),
        rows: employees.map((e) => ({
          employeeId: e.id,
          employeeName: displayName(e),
          employeeCode: e.employeeCode,
          departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "") : "",
          balances: tracked.map((t) =>
            computeBalance(t, policyRule(e.leavePolicyId ? pol.get(e.leavePolicyId) : null, t.id), ledger.filter((l) => l.employeeId === e.id), pending.filter((p) => p.employeeId === e.id), asOf, e.hireDate),
          ),
        })),
      };
    },
  }),

  "leave.ledger": query({
    input: z.object({ employeeId: idSchema }),
    permission: ["leave.view", "self.view"],
    handler: async (ctx, { employeeId }) => {
      if (!hasPermission(ctx.actor, "leave.view") && employeeId !== ctx.actor.employeeId) throw notFound("Employee");
      await getScopedEmployee(ctx, employeeId);
      const [ledger, types] = await Promise.all([ledgerFor(ctx, employeeId), ctx.repo.leaveTypes.list(ctx.actor.companyId)]);
      const t = new Map(types.map((x) => [x.id, x.name]));
      return ledger.reverse().map((l) => ({ ...l, leaveTypeName: t.get(l.leaveTypeId) ?? "—" }));
    },
  }),

  "leave.adjust": mutation({
    input: z.object({ employeeId: idSchema, leaveTypeId: idSchema, amount: z.number().min(-365).max(365).refine((x) => x !== 0, "Enter a non-zero amount"), date: isoDate, reason: nonEmpty(300) }),
    permission: "leave.adjust",
    handler: async (ctx, input) => {
      const e = await getScopedEmployee(ctx, input.employeeId);
      const type = await ctx.repo.leaveTypes.get(ctx.actor.companyId, input.leaveTypeId);
      if (!type || !type.tracksBalance) throw validation("Choose a leave type that tracks a balance.");
      const now = nowISO(ctx);
      const entry: LeaveLedgerEntry = { id: ctx.ids("lvl"), companyId: ctx.actor.companyId, employeeId: e.id, leaveTypeId: type.id, date: input.date, amount: input.amount, kind: "adjustment", reason: input.reason, requestId: null, createdBy: ctx.actor.userId, createdAt: now, updatedAt: now };
      await ctx.repo.leaveLedger.insert(entry);
      await audit(ctx, { action: "leave.adjusted", entityType: "employee", entityId: e.id, summary: `Adjusted ${type.name} balance by ${input.amount > 0 ? "+" : ""}${input.amount} ${type.unit} for ${displayName(e)}`, reason: input.reason });
      return entry;
    },
  }),

  "leave.yearEnd": mutation({
    input: z.object({ newYear: z.number().int().min(2000).max(2100) }),
    permission: "leave.adjust",
    handler: async (ctx, { newYear }) => {
      const [employees, types, policies] = await Promise.all([
        ctx.repo.employees.list(ctx.actor.companyId, { where: { status: ["active", "on_leave", "onboarding"] } }),
        ctx.repo.leaveTypes.list(ctx.actor.companyId, { where: { active: true } }),
        ctx.repo.leavePolicies.list(ctx.actor.companyId),
      ]);
      const pol = new Map(policies.map((p) => [p.id, p]));
      const now = nowISO(ctx);
      let created = 0;
      let skipped = 0;
      const entries: LeaveLedgerEntry[] = [];
      for (const e of employees) {
        const policy = e.leavePolicyId ? pol.get(e.leavePolicyId) : null;
        if (!policy) continue;
        const ledger = await ledgerFor(ctx, e.id);
        for (const t of types.filter((x) => x.tracksBalance)) {
          const rule = policyRule(policy, t.id);
          if (!rule) continue;
          const already = ledger.some((l) => l.leaveTypeId === t.id && yearOf(l.date) === newYear && (l.kind === "allocation" || l.kind === "carry_forward"));
          if (already) {
            skipped += 1;
            continue;
          }
          const closing = computeBalance(t, rule, ledger, [], `${newYear - 1}-12-31`, e.hireDate).available;
          for (const p of planYearEnd(e.id, t, rule, closing, newYear)) {
            entries.push({ id: ctx.ids("lvl"), companyId: ctx.actor.companyId, employeeId: e.id, leaveTypeId: t.id, date: p.date, amount: p.amount, kind: p.kind, reason: p.reason, requestId: null, createdBy: ctx.actor.userId, createdAt: now, updatedAt: now });
            created += 1;
          }
          // Expire last year's unused carry-forward if its expiry date has passed in the closing year
          const carried = ledger.filter((l) => l.leaveTypeId === t.id && yearOf(l.date) === newYear - 1 && l.kind === "carry_forward").reduce((s, l) => s + l.amount, 0);
          const takenEarly = -ledger.filter((l) => l.leaveTypeId === t.id && yearOf(l.date) === newYear - 1 && (l.kind === "taken" || l.kind === "reversal")).reduce((s, l) => s + l.amount, 0);
          const exp = planCarryForwardExpiry(rule, carried, takenEarly, newYear - 1);
          if (exp && !ledger.some((l) => l.kind === "expiry" && l.leaveTypeId === t.id && yearOf(l.date) === newYear - 1)) {
            entries.push({ id: ctx.ids("lvl"), companyId: ctx.actor.companyId, employeeId: e.id, leaveTypeId: t.id, date: exp.date, amount: exp.amount, kind: "expiry", reason: "Unused carried-forward balance expired", requestId: null, createdBy: ctx.actor.userId, createdAt: now, updatedAt: now });
            created += 1;
          }
        }
      }
      if (entries.length) await ctx.repo.leaveLedger.insertMany(entries);
      await audit(ctx, { action: "leave.year_end", entityType: "company", entityId: ctx.actor.companyId, summary: `Year-end leave processing for ${newYear}: ${created} ledger entries, ${skipped} already processed` });
      return { created, skipped };
    },
  }),

  "leave.calendar": query({
    input: z.object({ from: isoDate, to: isoDate, departmentId: idSchema.optional() }),
    permission: ["leave.view", "self.view"],
    handler: async (ctx, input) => {
      const company = await getCompany(ctx);
      const selfOnly = !hasPermission(ctx.actor, "leave.view");
      const employees = await ctx.repo.employees.list(ctx.actor.companyId, {
        where: { ...(selfOnly ? { id: ctx.actor.employeeId ? [ctx.actor.employeeId] : [] } : scopeWhere(ctx.actor)), departmentId: input.departmentId, status: ["active", "on_leave", "onboarding"] },
      });
      const ids = employees.map((e) => e.id);
      const [requests, types] = await Promise.all([
        ids.length
          ? ctx.repo.leaveRequests.list(ctx.actor.companyId, { where: { employeeId: ids, status: ["pending", "approved"] }, overlaps: { startField: "startDate", endField: "endDate", start: input.from, end: input.to } })
          : Promise.resolve([]),
        ctx.repo.leaveTypes.list(ctx.actor.companyId),
      ]);
      const t = new Map(types.map((x) => [x.id, x]));
      return {
        employees: employees.map((e) => ({ id: e.id, name: displayName(e), departmentId: e.departmentId })),
        requests: requests.map((r) => ({ id: r.id, employeeId: r.employeeId, startDate: r.startDate, endDate: r.endDate, status: r.status, quantity: r.quantity, unit: r.unit, leaveTypeName: t.get(r.leaveTypeId)?.name ?? "", color: t.get(r.leaveTypeId)?.color ?? "#777" })),
        holidays: company.holidays.filter((h) => h.date >= input.from && h.date <= input.to),
      };
    },
  }),
};
