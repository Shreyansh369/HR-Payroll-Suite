import { z } from "zod";
import type { Employee, EmploymentEvent, LeaveLedgerEntry, PayRate, WorkSchedule } from "@/domain/types";
import { audit, companyToday, diff, idSchema, isoDate, money, mutation, nonEmpty, nowISO, optionalText, query } from "@/services/core";
import {
  canSeeSensitive,
  departmentNames,
  displayName,
  getCompany,
  getScopedEmployee,
  nameOf,
  redactEmployee,
  scopeWhere,
} from "@/services/helpers";
import { assertPermission, hasPermission, reportsOf } from "@/services/authz";
import { withEffectiveTo, effectiveOn } from "@/domain/employee/schedule";
import { monthOf, yearOf } from "@/lib/dates";
import { conflict, notFound, validation } from "@/lib/errors";
import { ONBOARDING_TEMPLATE } from "@/config/defaults";
import { addDays } from "@/lib/dates";

export const addressSchema = z.object({
  line1: z.string().trim().max(200).default(""),
  line2: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().max(100).default(""),
  region: z.string().trim().max(100).optional().default(""),
  postalCode: z.string().trim().max(20).optional().default(""),
  country: z.string().trim().max(100).default(""),
});

const emergencySchema = z.object({
  name: z.string().trim().max(120).default(""),
  relationship: z.string().trim().max(60).default(""),
  phone: z.string().trim().max(40).default(""),
});

const statutorySchema = z.object({
  socialSecurityNumber: z.string().trim().max(40).default(""),
  nhiNumber: z.string().trim().max(40).default(""),
  taxId: z.string().trim().max(40).default(""),
});

const payProfileSchema = z.object({
  payMethod: z.enum(["bank_transfer", "cheque", "cash"]),
  bankName: z.string().trim().max(100).default(""),
  bankAccount: z.string().trim().max(40).default(""),
});

const employmentType = z.enum(["full_time", "part_time", "contract", "temporary"]);
const status = z.enum(["onboarding", "active", "on_leave", "terminated", "archived"]);

export const rateInput = z.object({
  payType: z.enum(["salary", "hourly"]),
  amount: money.positive("Must be greater than zero"),
  basis: z.enum(["annual", "monthly", "semi_monthly", "biweekly", "weekly", "daily", "hourly"]),
  payFrequency: z.enum(["weekly", "biweekly", "semi_monthly", "monthly"]),
});

export const scheduleInput = z.object({
  workDays: z.array(z.number().int().min(0).max(6)).min(1, "Select at least one working day").max(7),
  hoursPerDay: z.number().min(0.5).max(24),
});

const profileFields = {
  firstName: nonEmpty(80),
  lastName: nonEmpty(80),
  preferredName: z.string().trim().max(80).default(""),
  dateOfBirth: isoDate,
  email: z.union([z.literal(""), z.email("Enter a valid email")]).default(""),
  phone: z.string().trim().max(40).default(""),
  address: addressSchema,
  emergencyContact: emergencySchema,
  statutoryIds: statutorySchema,
};

export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  name: string;
  legalName: string;
  position: string;
  departmentId: string | null;
  departmentName: string;
  managerId: string | null;
  managerName: string;
  status: Employee["status"];
  employmentType: Employee["employmentType"];
  hireDate: string;
  terminationDate: string | null;
  workLocation: string;
  email: string;
  phone: string;
  dateOfBirth: string;
}

async function allocateInitialLeave(ctx: Parameters<typeof getCompany>[0], employee: Employee, today: string) {
  if (!employee.leavePolicyId) return;
  const policy = await ctx.repo.leavePolicies.get(ctx.actor.companyId, employee.leavePolicyId);
  if (!policy) return;
  const year = Math.max(yearOf(today), yearOf(employee.hireDate));
  const now = nowISO(ctx);
  const entries: LeaveLedgerEntry[] = [];
  for (const rule of policy.rules) {
    if (rule.accrual !== "upfront" || rule.annualEntitlement <= 0) continue;
    const startMonth = yearOf(employee.hireDate) === year ? monthOf(employee.hireDate) : 1;
    const months = 12 - startMonth + 1;
    const amount = Math.round(((rule.annualEntitlement * months) / 12) * 2) / 2;
    if (amount <= 0) continue;
    entries.push({
      id: ctx.ids("lvl"),
      companyId: ctx.actor.companyId,
      employeeId: employee.id,
      leaveTypeId: rule.leaveTypeId,
      date: yearOf(employee.hireDate) === year ? employee.hireDate : `${year}-01-01`,
      amount,
      kind: "allocation",
      reason: months < 12 ? `${year} entitlement prorated for ${months} months` : `${year} entitlement`,
      requestId: null,
      createdBy: ctx.actor.userId,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (entries.length) await ctx.repo.leaveLedger.insertMany(entries);
}

export const employeeProcedures = {
  "employees.list": query({
    input: z.object({
      search: z.string().max(100).optional(),
      status: z.array(status).optional(),
      departmentId: idSchema.optional(),
      managerId: idSchema.optional(),
      employmentType: employmentType.optional(),
      workLocation: z.string().max(100).optional(),
      sort: z.enum(["name", "employeeCode", "hireDate", "position", "status"]).default("name"),
      dir: z.enum(["asc", "desc"]).default("asc"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(5).max(500).default(25),
    }),
    permission: "employee.view",
    handler: async (ctx, input) => {
      const orderBy =
        input.sort === "name"
          ? [
              { field: "lastName" as const, dir: input.dir },
              { field: "firstName" as const, dir: input.dir },
            ]
          : [{ field: input.sort, dir: input.dir }];
      const page = await ctx.repo.employees.page(ctx.actor.companyId, {
        where: {
          ...scopeWhere(ctx.actor),
          status: input.status?.length ? input.status : undefined,
          departmentId: input.departmentId,
          managerId: input.managerId,
          employmentType: input.employmentType,
          workLocation: input.workLocation,
        },
        search: input.search,
        orderBy,
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
      });
      const deps = await departmentNames(ctx);
      const managerIds = [...new Set(page.items.map((e) => e.managerId).filter((x): x is string => !!x))];
      const managers = managerIds.length ? await ctx.repo.employees.list(ctx.actor.companyId, { where: { id: managerIds } }) : [];
      const mgr = new Map(managers.map((m) => [m.id, displayName(m)]));
      const items: EmployeeListItem[] = page.items.map((e) => ({
        id: e.id,
        employeeCode: e.employeeCode,
        name: displayName(e),
        legalName: `${e.firstName} ${e.lastName}`,
        position: e.position,
        departmentId: e.departmentId,
        departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "—") : "—",
        managerId: e.managerId,
        managerName: e.managerId ? (mgr.get(e.managerId) ?? "—") : "—",
        status: e.status,
        employmentType: e.employmentType,
        hireDate: e.hireDate,
        terminationDate: e.terminationDate ?? null,
        workLocation: e.workLocation,
        email: e.email,
        phone: e.phone,
        dateOfBirth: e.dateOfBirth,
      }));
      return { items, total: page.total, page: input.page, pageSize: input.pageSize };
    },
  }),

  "employees.options": query({
    input: z.object({ includeInactive: z.boolean().default(false) }),
    permission: ["employee.view", "payroll.view", "leave.approve", "attendance.view"],
    handler: async (ctx, input) => {
      const list = await ctx.repo.employees.list(ctx.actor.companyId, {
        where: { ...scopeWhere(ctx.actor), status: input.includeInactive ? undefined : ["onboarding", "active", "on_leave"] },
      });
      return list.map((e) => ({ id: e.id, name: displayName(e), employeeCode: e.employeeCode, status: e.status, departmentId: e.departmentId, position: e.position }));
    },
  }),

  "employees.filters": query({
    input: z.object({}),
    permission: "employee.view",
    handler: async (ctx) => {
      const list = await ctx.repo.employees.list(ctx.actor.companyId, { where: scopeWhere(ctx.actor) });
      const managers = new Map<string, string>();
      for (const e of list) {
        if (e.managerId && !managers.has(e.managerId)) {
          const m = list.find((x) => x.id === e.managerId);
          if (m) managers.set(m.id, displayName(m));
        }
      }
      return {
        locations: [...new Set(list.map((e) => e.workLocation).filter(Boolean))].sort(),
        managers: [...managers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
  }),

  "employees.get": query({
    input: z.object({ id: idSchema }),
    permission: ["employee.view", "self.view"],
    handler: async (ctx, { id }) => {
      if (!hasPermission(ctx.actor, "employee.view") && ctx.actor.employeeId !== id) throw notFound("Employee");
      const e = await getScopedEmployee(ctx, id);
      const company = await getCompany(ctx);
      const [deps, manager, schedules, policy, user] = await Promise.all([
        departmentNames(ctx),
        e.managerId ? ctx.repo.employees.get(ctx.actor.companyId, e.managerId) : Promise.resolve(null),
        ctx.repo.schedules.list(ctx.actor.companyId, { where: { employeeId: id } }),
        e.leavePolicyId ? ctx.repo.leavePolicies.get(ctx.actor.companyId, e.leavePolicyId) : Promise.resolve(null),
        e.userId ? ctx.repo.users.get(e.userId) : Promise.resolve(null),
      ]);
      const today = await companyToday(ctx);
      const directReports = await ctx.repo.employees.list(ctx.actor.companyId, { where: { managerId: id, status: ["active", "on_leave", "onboarding"] } });
      const canSalary = hasPermission(ctx.actor, "salary.view") || ctx.actor.employeeId === id;
      let currentRate: PayRate | null = null;
      if (canSalary) {
        const rates = await ctx.repo.payRates.list(ctx.actor.companyId, { where: { employeeId: id } });
        currentRate = effectiveOn(rates, today) ?? rates[rates.length - 1] ?? null;
      }
      return {
        employee: redactEmployee(ctx.actor, e),
        departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "—") : "—",
        managerName: nameOf(manager),
        leavePolicyName: policy?.name ?? "—",
        currentSchedule: effectiveOn(schedules, today) ?? schedules[schedules.length - 1] ?? null,
        currentRate,
        canSeeSalary: canSalary,
        canSeeSensitive: canSeeSensitive(ctx.actor, id),
        directReports: directReports.map((r) => ({ id: r.id, name: displayName(r), position: r.position })),
        userAccount: user ? { id: user.id, email: user.email, status: user.status } : null,
        currency: company.currency,
      };
    },
  }),

  "employees.create": mutation({
    input: z.object({
      employeeCode: z.string().trim().min(1, "Required").max(20).regex(/^[A-Za-z0-9._-]+$/, "Letters, numbers, dot, dash or underscore"),
      ...profileFields,
      employmentType,
      hireDate: isoDate,
      probationEndDate: isoDate.nullable().default(null),
      departmentId: idSchema.nullable(),
      position: nonEmpty(120),
      managerId: idSchema.nullable(),
      workLocation: z.string().trim().max(100).default(""),
      leavePolicyId: idSchema.nullable(),
      payProfile: payProfileSchema,
      schedule: scheduleInput,
      rate: rateInput.nullable(),
      startOnboarding: z.boolean().default(true),
    }),
    permission: "employee.create",
    feature: "hr",
    handler: async (ctx, input) => {
      if (input.rate) assertPermission(ctx.actor, "salary.edit");
      if (ctx.entitlements.employeeLimit !== null) {
        const active = await ctx.repo.employees.count(ctx.actor.companyId, { where: { status: ["active", "onboarding", "on_leave"] } });
        if (active >= ctx.entitlements.employeeLimit) throw conflict(`Your plan allows ${ctx.entitlements.employeeLimit} active employees.`);
      }
      if (input.probationEndDate && input.probationEndDate < input.hireDate) throw validation("Probation end must be after the hire date.");
      if (input.managerId) {
        const m = await ctx.repo.employees.get(ctx.actor.companyId, input.managerId);
        if (!m) throw validation("Manager not found in this company.");
      }
      const today = await companyToday(ctx);
      const now = nowISO(ctx);
      const id = ctx.ids("emp");
      const employee: Employee = {
        id,
        companyId: ctx.actor.companyId,
        employeeCode: input.employeeCode.toUpperCase(),
        firstName: input.firstName,
        lastName: input.lastName,
        preferredName: input.preferredName,
        dateOfBirth: input.dateOfBirth,
        email: input.email,
        phone: input.phone,
        address: input.address,
        emergencyContact: input.emergencyContact,
        statutoryIds: input.statutoryIds,
        status: input.startOnboarding && input.hireDate >= today ? "onboarding" : "active",
        employmentType: input.employmentType,
        hireDate: input.hireDate,
        probationEndDate: input.probationEndDate,
        terminationDate: null,
        terminationReason: null,
        departmentId: input.departmentId,
        position: input.position,
        managerId: input.managerId,
        workLocation: input.workLocation,
        leavePolicyId: input.leavePolicyId,
        payProfile: hasPermission(ctx.actor, "salary.edit") ? input.payProfile : { payMethod: input.payProfile.payMethod, bankName: "", bankAccount: "" },
        notes: [],
        userId: null,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.repo.transaction(async (repo) => {
        await repo.employees.insert(employee);
        const hire: EmploymentEvent = {
          id: ctx.ids("evt"),
          companyId: ctx.actor.companyId,
          employeeId: id,
          effectiveDate: input.hireDate,
          type: "hire",
          departmentId: input.departmentId,
          position: input.position,
          managerId: input.managerId,
          employmentType: input.employmentType,
          workLocation: input.workLocation,
          note: "Hired",
          createdBy: ctx.actor.userId,
          createdAt: now,
          updatedAt: now,
        };
        await repo.employmentEvents.insert(hire);
        const schedule: WorkSchedule = {
          id: ctx.ids("sch"),
          companyId: ctx.actor.companyId,
          employeeId: id,
          effectiveFrom: input.hireDate,
          workDays: [...new Set(input.schedule.workDays)].sort(),
          hoursPerDay: input.schedule.hoursPerDay,
          reason: "Initial schedule",
          createdBy: ctx.actor.userId,
          createdAt: now,
          updatedAt: now,
        };
        await repo.schedules.insert(schedule);
        if (input.rate) {
          await repo.payRates.insert({
            id: ctx.ids("rate"),
            companyId: ctx.actor.companyId,
            employeeId: id,
            effectiveFrom: input.hireDate,
            ...input.rate,
            reason: "Starting rate",
            createdBy: ctx.actor.userId,
            createdAt: now,
            updatedAt: now,
          });
        }
        if (input.startOnboarding) {
          await repo.workflows.insert({
            id: ctx.ids("wf"),
            companyId: ctx.actor.companyId,
            employeeId: id,
            type: "onboarding",
            status: "in_progress",
            startDate: input.hireDate,
            tasks: ONBOARDING_TEMPLATE.map((t) => ({
              id: ctx.ids("task"),
              title: t.title,
              owner: t.owner,
              category: t.category,
              dueDate: addDays(input.hireDate, t.offsetDays),
              done: false,
            })),
            createdBy: ctx.actor.userId,
            createdAt: now,
            updatedAt: now,
          });
        }
      });
      await allocateInitialLeave(ctx, employee, today);
      await audit(ctx, {
        action: "employee.created",
        entityType: "employee",
        entityId: id,
        summary: `Added employee ${displayName(employee)} (${employee.employeeCode})`,
        after: { ...employee, statutoryIds: "[redacted]", payProfile: "[redacted]" },
      });
      if (input.rate) {
        await audit(ctx, { action: "salary.changed", entityType: "employee", entityId: id, summary: `Set starting rate for ${displayName(employee)}`, after: input.rate });
      }
      return { id };
    },
  }),

  "employees.update": mutation({
    input: z.object({
      id: idSchema,
      ...profileFields,
      probationEndDate: isoDate.nullable(),
      workLocation: z.string().trim().max(100),
      leavePolicyId: idSchema.nullable(),
      payProfile: payProfileSchema.optional(),
      status: z.enum(["onboarding", "active", "on_leave"]).optional(),
    }),
    permission: "employee.edit",
    handler: async (ctx, input) => {
      const before = await getScopedEmployee(ctx, input.id);
      if (before.status === "archived") throw conflict("Restore this employee before editing.");
      const { id, payProfile, ...rest } = input;
      const patch: Partial<Employee> = { ...rest, updatedAt: nowISO(ctx) };
      if (!canSeeSensitive(ctx.actor, id)) delete patch.statutoryIds;
      if (payProfile) {
        assertPermission(ctx.actor, "salary.edit");
        patch.payProfile = payProfile;
      }
      if (input.status && (before.status === "terminated")) delete patch.status;
      const updated = await ctx.repo.employees.update(ctx.actor.companyId, id, patch);
      const d = diff(before, patch);
      if (d) {
        const redact = (o: Partial<Employee>) => ({ ...o, ...(o.statutoryIds ? { statutoryIds: "[changed]" } : {}), ...(o.payProfile ? { payProfile: "[changed]" } : {}) });
        await audit(ctx, { action: "employee.updated", entityType: "employee", entityId: id, summary: `Updated ${displayName(updated)}`, before: redact(d.before), after: redact(d.after) });
      }
      return redactEmployee(ctx.actor, updated);
    },
  }),

  "employees.recordEvent": mutation({
    input: z.object({
      employeeId: idSchema,
      type: z.enum(["promotion", "transfer", "department_change", "manager_change", "employment_type_change", "position_change", "rehire"]),
      effectiveDate: isoDate,
      departmentId: idSchema.nullable().optional(),
      position: z.string().trim().max(120).optional(),
      managerId: idSchema.nullable().optional(),
      employmentType: employmentType.optional(),
      workLocation: z.string().trim().max(100).optional(),
      note: optionalText(500),
    }),
    permission: "employee.edit",
    handler: async (ctx, input) => {
      const e = await getScopedEmployee(ctx, input.employeeId);
      if (input.managerId === e.id) throw validation("An employee cannot report to themselves.");
      if (input.managerId) {
        const all = await ctx.repo.employees.list(ctx.actor.companyId);
        if (reportsOf(all, e.id).has(input.managerId)) throw validation("That manager reports to this employee; this would create a reporting loop.");
      }
      if (input.type === "rehire" && e.status !== "terminated" && e.status !== "archived") throw conflict("Only terminated employees can be rehired.");
      if (input.type !== "rehire" && (e.status === "terminated" || e.status === "archived")) throw conflict("This employee is no longer employed.");
      const now = nowISO(ctx);
      const today = await companyToday(ctx);
      const event: EmploymentEvent = {
        id: ctx.ids("evt"),
        companyId: ctx.actor.companyId,
        employeeId: e.id,
        effectiveDate: input.effectiveDate,
        type: input.type,
        departmentId: input.departmentId,
        position: input.position || undefined,
        managerId: input.managerId,
        employmentType: input.employmentType,
        workLocation: input.workLocation || undefined,
        note: input.note,
        createdBy: ctx.actor.userId,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.repo.employmentEvents.insert(event);
      const patch: Partial<Employee> = { updatedAt: now };
      if (input.effectiveDate <= today || input.type === "rehire") {
        if (input.departmentId !== undefined) patch.departmentId = input.departmentId;
        if (input.position) patch.position = input.position;
        if (input.managerId !== undefined) patch.managerId = input.managerId;
        if (input.employmentType) patch.employmentType = input.employmentType;
        if (input.workLocation) patch.workLocation = input.workLocation;
        if (input.type === "rehire") {
          patch.status = input.effectiveDate > today ? "onboarding" : "active";
          patch.hireDate = input.effectiveDate;
          patch.terminationDate = null;
          patch.terminationReason = null;
        }
      }
      const before = { departmentId: e.departmentId, position: e.position, managerId: e.managerId, employmentType: e.employmentType, workLocation: e.workLocation };
      await ctx.repo.employees.update(ctx.actor.companyId, e.id, patch);
      await audit(ctx, {
        action: `employee.${input.type}`,
        entityType: "employee",
        entityId: e.id,
        summary: `${input.type.replace(/_/g, " ")} for ${displayName(e)} effective ${input.effectiveDate}`,
        before,
        after: patch,
      });
      return event;
    },
  }),

  /** Applies future-dated employment events that have become effective. Idempotent. */
  "employees.applyScheduledChanges": mutation({
    input: z.object({}),
    permission: "employee.edit",
    handler: async (ctx) => {
      const today = await companyToday(ctx);
      const events = await ctx.repo.employmentEvents.list(ctx.actor.companyId, { range: { field: "effectiveDate", lte: today } });
      const employees = await ctx.repo.employees.list(ctx.actor.companyId);
      let applied = 0;
      for (const e of employees) {
        const mine = events.filter((x) => x.employeeId === e.id && x.type !== "hire" && x.type !== "termination");
        const patch: Partial<Employee> = {};
        for (const ev of mine) {
          if (ev.departmentId !== undefined && ev.departmentId !== e.departmentId) patch.departmentId = ev.departmentId;
          if (ev.position && ev.position !== e.position) patch.position = ev.position;
          if (ev.managerId !== undefined && ev.managerId !== e.managerId) patch.managerId = ev.managerId;
          if (ev.employmentType && ev.employmentType !== e.employmentType) patch.employmentType = ev.employmentType;
        }
        if (e.terminationDate && e.terminationDate < today && (e.status === "active" || e.status === "on_leave")) patch.status = "terminated";
        if (e.status === "onboarding" && e.hireDate <= today) {
          const wf = await ctx.repo.workflows.list(ctx.actor.companyId, { where: { employeeId: e.id, type: "onboarding", status: "in_progress" } });
          if (wf.length === 0) patch.status = "active";
        }
        if (Object.keys(patch).length) {
          await ctx.repo.employees.update(ctx.actor.companyId, e.id, { ...patch, updatedAt: nowISO(ctx) });
          applied += 1;
        }
      }
      if (applied) await audit(ctx, { action: "employee.scheduled_changes_applied", entityType: "employee", summary: `Applied scheduled employment changes to ${applied} employee(s)` });
      return { applied };
    },
  }),

  "employees.timeline": query({
    input: z.object({ id: idSchema }),
    permission: ["employee.view", "self.view"],
    handler: async (ctx, { id }) => {
      if (!hasPermission(ctx.actor, "employee.view") && ctx.actor.employeeId !== id) throw notFound("Employee");
      await getScopedEmployee(ctx, id);
      const [events, schedules, deps, employees] = await Promise.all([
        ctx.repo.employmentEvents.list(ctx.actor.companyId, { where: { employeeId: id } }),
        ctx.repo.schedules.list(ctx.actor.companyId, { where: { employeeId: id } }),
        departmentNames(ctx),
        ctx.repo.employees.list(ctx.actor.companyId),
      ]);
      const empName = new Map(employees.map((x) => [x.id, displayName(x)]));
      const items: { id: string; date: string; kind: string; title: string; detail: string }[] = events.map((ev) => {
        const parts: string[] = [];
        if (ev.position) parts.push(ev.position);
        if (ev.departmentId) parts.push(deps.get(ev.departmentId) ?? "");
        if (ev.managerId) parts.push(`reports to ${empName.get(ev.managerId) ?? "—"}`);
        if (ev.employmentType) parts.push(ev.employmentType.replace("_", "-"));
        if (ev.note) parts.push(ev.note);
        return { id: ev.id, date: ev.effectiveDate, kind: ev.type, title: ev.type.replace(/_/g, " "), detail: parts.filter(Boolean).join(" · ") };
      });
      for (const s of withEffectiveTo(schedules)) {
        items.push({ id: s.id, date: s.effectiveFrom, kind: "schedule_change", title: "schedule", detail: `${s.workDays.length} days × ${s.hoursPerDay} h${s.reason ? ` · ${s.reason}` : ""}` });
      }
      if (hasPermission(ctx.actor, "salary.view")) {
        const rates = await ctx.repo.payRates.list(ctx.actor.companyId, { where: { employeeId: id } });
        const company = await getCompany(ctx);
        for (const r of rates) {
          items.push({
            id: r.id,
            date: r.effectiveFrom,
            kind: "salary_change",
            title: "pay rate",
            detail: `${new Intl.NumberFormat("en-US", { style: "currency", currency: company.currency }).format(r.amount)} ${r.basis.replace("_", "-")}${r.reason ? ` · ${r.reason}` : ""}`,
          });
        }
      }
      return items.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
    },
  }),

  "employees.addNote": mutation({
    input: z.object({ employeeId: idSchema, body: nonEmpty(2000) }),
    permission: "employee.edit",
    handler: async (ctx, input) => {
      const e = await getScopedEmployee(ctx, input.employeeId);
      const note = { id: ctx.ids("note"), body: input.body, createdAt: nowISO(ctx), createdBy: ctx.actor.userId, createdByName: ctx.actor.name };
      await ctx.repo.employees.update(ctx.actor.companyId, e.id, { notes: [note, ...e.notes], updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "employee.note_added", entityType: "employee", entityId: e.id, summary: `Added a note to ${displayName(e)}` });
      return note;
    },
  }),

  "employees.deleteNote": mutation({
    input: z.object({ employeeId: idSchema, noteId: idSchema }),
    permission: "employee.edit",
    handler: async (ctx, input) => {
      const e = await getScopedEmployee(ctx, input.employeeId);
      const note = e.notes.find((n) => n.id === input.noteId);
      if (!note) throw notFound("Note");
      await ctx.repo.employees.update(ctx.actor.companyId, e.id, { notes: e.notes.filter((n) => n.id !== input.noteId), updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "employee.note_deleted", entityType: "employee", entityId: e.id, summary: `Deleted a note on ${displayName(e)}`, before: note });
      return { ok: true };
    },
  }),

  "employees.archive": mutation({
    input: z.object({ id: idSchema, reason: nonEmpty(300) }),
    permission: "employee.archive",
    handler: async (ctx, { id, reason }) => {
      const e = await getScopedEmployee(ctx, id);
      if (e.status !== "terminated") throw conflict("Only terminated employees can be archived. Complete offboarding first.");
      await ctx.repo.employees.update(ctx.actor.companyId, id, { status: "archived", updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "employee.archived", entityType: "employee", entityId: id, summary: `Archived ${displayName(e)}`, reason });
      return { ok: true };
    },
  }),

  "employees.restore": mutation({
    input: z.object({ id: idSchema }),
    permission: "employee.archive",
    handler: async (ctx, { id }) => {
      const e = await getScopedEmployee(ctx, id);
      if (e.status !== "archived") throw conflict("Employee is not archived.");
      await ctx.repo.employees.update(ctx.actor.companyId, id, { status: "terminated", updatedAt: nowISO(ctx) });
      await audit(ctx, { action: "employee.restored", entityType: "employee", entityId: id, summary: `Restored ${displayName(e)} from archive` });
      return { ok: true };
    },
  }),

  "employees.delete": mutation({
    input: z.object({ id: idSchema, confirmCode: z.string() }),
    permission: "employee.delete",
    handler: async (ctx, { id, confirmCode }) => {
      const e = await getScopedEmployee(ctx, id);
      if (confirmCode.trim().toUpperCase() !== e.employeeCode.toUpperCase()) throw validation("Type the Employee ID to confirm deletion.");
      const results = await ctx.repo.payrollResults.count(ctx.actor.companyId, { where: { employeeId: id } });
      if (results > 0) throw conflict("This employee has payroll history and cannot be deleted. Archive them instead.");
      const reports = await ctx.repo.employees.count(ctx.actor.companyId, { where: { managerId: id } });
      if (reports > 0) throw conflict("Reassign this employee's direct reports before deleting.");
      await ctx.repo.transaction(async (repo) => {
        const c = ctx.actor.companyId;
        const collections = [repo.employmentEvents, repo.payRates, repo.schedules, repo.payItems, repo.loans, repo.leaveLedger, repo.leaveRequests, repo.timesheets, repo.attendanceCorrections, repo.workflows] as const;
        for (const col of collections) {
          const rows = await (col as typeof repo.payRates).list(c, { where: { employeeId: id } } as never);
          for (const r of rows) await (col as typeof repo.payRates).remove(c, r.id);
        }
        const docs = await repo.documents.list(c, { where: { employeeId: id } });
        for (const doc of docs) {
          await ctx.storage.delete(doc.storageKey);
          await repo.documents.remove(c, doc.id);
        }
        await repo.employees.remove(c, id);
      });
      await audit(ctx, { action: "employee.deleted", entityType: "employee", entityId: id, summary: `Deleted ${displayName(e)} (${e.employeeCode})`, before: { employeeCode: e.employeeCode, name: displayName(e) } });
      return { ok: true };
    },
  }),

  "employees.orgChart": query({
    input: z.object({}),
    permission: "employee.view",
    handler: async (ctx) => {
      const [list, deps] = await Promise.all([
        ctx.repo.employees.list(ctx.actor.companyId, { where: { ...scopeWhere(ctx.actor), status: ["active", "on_leave", "onboarding"] } }),
        departmentNames(ctx),
      ]);
      const ids = new Set(list.map((e) => e.id));
      return list.map((e) => ({
        id: e.id,
        name: displayName(e),
        position: e.position,
        departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "") : "",
        managerId: e.managerId && ids.has(e.managerId) ? e.managerId : null,
        status: e.status,
      }));
    },
  }),
};
