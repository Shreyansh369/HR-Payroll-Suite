import { z } from "zod";
import type { AttendanceCorrection, TimesheetEntry } from "@/domain/types";
import { audit, idSchema, isoDate, mutation, nonEmpty, nowISO, optionalText, query } from "@/services/core";
import { departmentNames, displayName, finalizedRuns, getCompany, getScopedEmployee, scopeWhere } from "@/services/helpers";
import { assertEmployeeScope, canAccessEmployee, hasPermission } from "@/services/authz";
import { effectiveOn, isScheduledDay } from "@/domain/employee/schedule";
import { daysInclusive, eachDay, formatDate } from "@/lib/dates";
import { conflict, forbidden, invalidState, notFound, validation } from "@/lib/errors";

const hours = z.number().min(0).max(24);

async function lockedDates(ctx: Parameters<typeof getCompany>[0]) {
  const runs = await finalizedRuns(ctx);
  return (employeeId: string, date: string) =>
    runs.some((r) => r.type === "regular" && r.employeeIds.includes(employeeId) && r.periodStart <= date && r.periodEnd >= date);
}

export const attendanceProcedures = {
  "attendance.list": query({
    input: z.object({ from: isoDate, to: isoDate, employeeId: idSchema.optional(), status: z.array(z.enum(["submitted", "approved", "rejected"])).optional() }),
    permission: ["attendance.view", "self.view"],
    handler: async (ctx, input) => {
      if (daysInclusive(input.from, input.to) > 93) throw validation("Choose a range of up to 3 months.");
      const selfOnly = !hasPermission(ctx.actor, "attendance.view");
      if (input.employeeId) assertEmployeeScope(ctx.actor, input.employeeId);
      const ids = selfOnly ? (ctx.actor.employeeId ? [ctx.actor.employeeId] : []) : scopeWhere(ctx.actor).id;
      const [entries, employees, deps] = await Promise.all([
        ctx.repo.timesheets.list(ctx.actor.companyId, {
          where: { employeeId: input.employeeId ?? ids, status: input.status?.length ? input.status : undefined },
          range: { field: "date", gte: input.from, lte: input.to },
        }),
        ctx.repo.employees.list(ctx.actor.companyId, { where: { ...(ids ? { id: ids } : {}), status: ["active", "on_leave", "onboarding", "terminated"] } }),
        departmentNames(ctx),
      ]);
      const isLocked = await lockedDates(ctx);
      return {
        entries: entries.map((t) => ({ ...t, locked: t.status === "approved" && isLocked(t.employeeId, t.date) })),
        employees: employees
          .filter((e) => e.hireDate <= input.to && (!e.terminationDate || e.terminationDate >= input.from))
          .map((e) => ({ id: e.id, name: displayName(e), code: e.employeeCode, departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "") : "" }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        canEdit: hasPermission(ctx.actor, "attendance.edit"),
        canApprove: hasPermission(ctx.actor, "attendance.approve"),
      };
    },
  }),

  "attendance.save": mutation({
    input: z.object({
      entries: z
        .array(
          z.object({
            employeeId: idSchema,
            date: isoDate,
            workedHours: hours,
            overtimeHours: hours,
            lateMinutes: z.number().int().min(0).max(1440).default(0),
            absent: z.boolean().default(false),
            note: optionalText(300),
          }),
        )
        .min(1)
        .max(2000),
    }),
    permission: "attendance.edit",
    feature: "hr",
    handler: async (ctx, input) => {
      const isLocked = await lockedDates(ctx);
      const now = nowISO(ctx);
      let created = 0;
      let updated = 0;
      const schedulesByEmp = new Map<string, Awaited<ReturnType<typeof ctx.repo.schedules.list>>>();
      await ctx.repo.transaction(async (repo) => {
        for (const row of input.entries) {
          assertEmployeeScope(ctx.actor, row.employeeId);
          if (row.absent && (row.workedHours > 0 || row.overtimeHours > 0)) throw validation(`${formatDate(row.date)}: an absent day cannot have worked hours.`);
          if (!schedulesByEmp.has(row.employeeId)) schedulesByEmp.set(row.employeeId, await repo.schedules.list(ctx.actor.companyId, { where: { employeeId: row.employeeId } }));
          const s = effectiveOn(schedulesByEmp.get(row.employeeId)!, row.date);
          const scheduledHours = s && isScheduledDay(row.date, s.workDays) ? s.hoursPerDay : 0;
          const [existing] = await repo.timesheets.list(ctx.actor.companyId, { where: { employeeId: row.employeeId, date: row.date } });
          if (existing) {
            if (existing.status === "approved" && isLocked(row.employeeId, row.date)) {
              throw conflict(`${formatDate(row.date)} is in a finalized payroll period. Submit a correction instead.`);
            }
            const same = existing.workedHours === row.workedHours && existing.overtimeHours === row.overtimeHours && existing.absent === row.absent && existing.lateMinutes === row.lateMinutes && existing.note === row.note;
            if (same) continue;
            await repo.timesheets.update(ctx.actor.companyId, existing.id, { ...row, scheduledHours, status: "submitted", approvedBy: null, approvedAt: null, updatedAt: now });
            updated += 1;
          } else {
            const entry: TimesheetEntry = { id: ctx.ids("ts"), companyId: ctx.actor.companyId, ...row, scheduledHours, status: "submitted", source: "manual", approvedBy: null, approvedAt: null, createdAt: now, updatedAt: now };
            await repo.timesheets.insert(entry);
            created += 1;
          }
        }
      });
      if (created + updated > 0) {
        await audit(ctx, { action: "attendance.saved", entityType: "timesheet", summary: `Saved timesheets: ${created} new, ${updated} changed` });
      }
      return { created, updated };
    },
  }),

  "attendance.fillFromSchedule": mutation({
    input: z.object({ from: isoDate, to: isoDate, employeeIds: z.array(idSchema).optional() }),
    permission: "attendance.edit",
    handler: async (ctx, input) => {
      if (daysInclusive(input.from, input.to) > 31) throw validation("Fill at most one month at a time.");
      const company = await getCompany(ctx);
      const holidays = new Set(company.holidays.map((h) => h.date));
      const employees = await ctx.repo.employees.list(ctx.actor.companyId, { where: { ...scopeWhere(ctx.actor), status: ["active", "on_leave"] } });
      const target = employees.filter((e) => !input.employeeIds || input.employeeIds.includes(e.id));
      const [schedules, existing, leave] = await Promise.all([
        ctx.repo.schedules.list(ctx.actor.companyId),
        ctx.repo.timesheets.list(ctx.actor.companyId, { range: { field: "date", gte: input.from, lte: input.to } }),
        ctx.repo.leaveRequests.list(ctx.actor.companyId, { where: { status: "approved" }, overlaps: { startField: "startDate", endField: "endDate", start: input.from, end: input.to } }),
      ]);
      const have = new Set(existing.map((t) => `${t.employeeId}|${t.date}`));
      const now = nowISO(ctx);
      const rows: TimesheetEntry[] = [];
      for (const e of target) {
        const mine = schedules.filter((s) => s.employeeId === e.id);
        for (const day of eachDay(input.from, input.to)) {
          if (day < e.hireDate || (e.terminationDate && day > e.terminationDate)) continue;
          if (have.has(`${e.id}|${day}`) || holidays.has(day)) continue;
          const s = effectiveOn(mine, day);
          if (!s || !isScheduledDay(day, s.workDays)) continue;
          if (leave.some((l) => l.employeeId === e.id && l.startDate <= day && l.endDate >= day)) continue;
          rows.push({ id: ctx.ids("ts"), companyId: ctx.actor.companyId, employeeId: e.id, date: day, scheduledHours: s.hoursPerDay, workedHours: s.hoursPerDay, overtimeHours: 0, lateMinutes: 0, absent: false, status: "submitted", source: "manual", note: "Filled from schedule", approvedBy: null, approvedAt: null, createdAt: now, updatedAt: now });
        }
      }
      if (rows.length) await ctx.repo.timesheets.insertMany(rows);
      await audit(ctx, { action: "attendance.filled", entityType: "timesheet", summary: `Filled ${rows.length} timesheet day(s) from schedules (${formatDate(input.from)} – ${formatDate(input.to)})` });
      return { created: rows.length };
    },
  }),

  "attendance.decide": mutation({
    input: z.object({ ids: z.array(idSchema).min(1).max(5000), decision: z.enum(["approve", "reject"]) }),
    permission: "attendance.approve",
    handler: async (ctx, input) => {
      const now = nowISO(ctx);
      let changed = 0;
      await ctx.repo.transaction(async (repo) => {
        for (const id of input.ids) {
          const t = await repo.timesheets.get(ctx.actor.companyId, id);
          if (!t) throw notFound("Timesheet entry");
          if (!canAccessEmployee(ctx.actor, t.employeeId)) throw notFound("Timesheet entry");
          if (t.employeeId === ctx.actor.employeeId) throw forbidden("You cannot approve your own timesheet.");
          if (t.status !== "submitted") continue;
          await repo.timesheets.update(ctx.actor.companyId, id, { status: input.decision === "approve" ? "approved" : "rejected", approvedBy: ctx.actor.userId, approvedAt: now, updatedAt: now });
          changed += 1;
        }
      });
      await audit(ctx, { action: input.decision === "approve" ? "attendance.approved" : "attendance.rejected", entityType: "timesheet", summary: `${input.decision === "approve" ? "Approved" : "Rejected"} ${changed} timesheet day(s)` });
      return { changed };
    },
  }),

  "attendance.corrections.list": query({
    input: z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }),
    permission: ["attendance.view", "self.view"],
    handler: async (ctx, input) => {
      const selfOnly = !hasPermission(ctx.actor, "attendance.view");
      const ids = selfOnly ? (ctx.actor.employeeId ? [ctx.actor.employeeId] : []) : scopeWhere(ctx.actor).id;
      const [rows, employees] = await Promise.all([
        ctx.repo.attendanceCorrections.list(ctx.actor.companyId, { where: { employeeId: ids, status: input.status } }),
        ctx.repo.employees.list(ctx.actor.companyId),
      ]);
      const emp = new Map(employees.map((e) => [e.id, displayName(e)]));
      return rows.map((r) => ({
        ...r,
        employeeName: emp.get(r.employeeId) ?? "—",
        canDecide: r.status === "pending" && hasPermission(ctx.actor, "attendance.approve") && canAccessEmployee(ctx.actor, r.employeeId) && r.employeeId !== ctx.actor.employeeId,
      }));
    },
  }),

  "attendance.corrections.request": mutation({
    input: z.object({ employeeId: idSchema.optional(), date: isoDate, requestedWorkedHours: hours, requestedOvertimeHours: hours, reason: nonEmpty(500) }),
    permission: ["self.view", "attendance.edit"],
    handler: async (ctx, input) => {
      const employeeId = input.employeeId ?? ctx.actor.employeeId;
      if (!employeeId) throw validation("Select an employee.");
      if (employeeId !== ctx.actor.employeeId && !hasPermission(ctx.actor, "attendance.edit")) throw forbidden();
      const e = await getScopedEmployee(ctx, employeeId);
      const [entry] = await ctx.repo.timesheets.list(ctx.actor.companyId, { where: { employeeId, date: input.date } });
      const pending = await ctx.repo.attendanceCorrections.list(ctx.actor.companyId, { where: { employeeId, date: input.date, status: "pending" } });
      if (pending.length) throw conflict("A correction for this day is already pending.");
      const now = nowISO(ctx);
      const corr: AttendanceCorrection = {
        id: ctx.ids("atc"),
        companyId: ctx.actor.companyId,
        employeeId,
        entryId: entry?.id ?? null,
        date: input.date,
        requestedWorkedHours: input.requestedWorkedHours,
        requestedOvertimeHours: input.requestedOvertimeHours,
        reason: input.reason,
        status: "pending",
        requestedBy: ctx.actor.userId,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.repo.attendanceCorrections.insert(corr);
      await audit(ctx, { action: "attendance.correction_requested", entityType: "attendance_correction", entityId: corr.id, summary: `Correction requested for ${displayName(e)} on ${formatDate(input.date)}`, reason: input.reason });
      return corr;
    },
  }),

  "attendance.corrections.decide": mutation({
    input: z.object({ id: idSchema, decision: z.enum(["approve", "reject"]), note: optionalText(300) }),
    permission: "attendance.approve",
    handler: async (ctx, input) => {
      const corr = await ctx.repo.attendanceCorrections.get(ctx.actor.companyId, input.id);
      if (!corr) throw notFound("Correction");
      assertEmployeeScope(ctx.actor, corr.employeeId);
      if (corr.employeeId === ctx.actor.employeeId) throw forbidden("You cannot approve your own correction.");
      if (corr.status !== "pending") throw invalidState(`This correction is already ${corr.status}.`);
      const isLocked = await lockedDates(ctx);
      if (input.decision === "approve" && isLocked(corr.employeeId, corr.date)) {
        throw conflict("This day is in a finalized payroll. Reject the correction and pay the difference through a payroll correction run.");
      }
      const now = nowISO(ctx);
      await ctx.repo.transaction(async (repo) => {
        await repo.attendanceCorrections.update(ctx.actor.companyId, corr.id, { status: input.decision === "approve" ? "approved" : "rejected", decidedBy: ctx.actor.userId, decidedAt: now, decisionNote: input.note || null, updatedAt: now });
        if (input.decision === "approve") {
          const [entry] = await repo.timesheets.list(ctx.actor.companyId, { where: { employeeId: corr.employeeId, date: corr.date } });
          const patch = { workedHours: corr.requestedWorkedHours, overtimeHours: corr.requestedOvertimeHours, absent: false, status: "approved" as const, source: "correction" as const, approvedBy: ctx.actor.userId, approvedAt: now, note: `Correction: ${corr.reason}`, updatedAt: now };
          if (entry) await repo.timesheets.update(ctx.actor.companyId, entry.id, patch);
          else {
            const schedules = await repo.schedules.list(ctx.actor.companyId, { where: { employeeId: corr.employeeId } });
            const s = effectiveOn(schedules, corr.date);
            await repo.timesheets.insert({ id: ctx.ids("ts"), companyId: ctx.actor.companyId, employeeId: corr.employeeId, date: corr.date, scheduledHours: s && isScheduledDay(corr.date, s.workDays) ? s.hoursPerDay : 0, lateMinutes: 0, createdAt: now, ...patch });
          }
        }
      });
      await audit(ctx, { action: `attendance.correction_${input.decision === "approve" ? "approved" : "rejected"}`, entityType: "attendance_correction", entityId: corr.id, summary: `${input.decision === "approve" ? "Approved" : "Rejected"} attendance correction for ${formatDate(corr.date)}`, reason: input.note || null });
      return { ok: true };
    },
  }),
};
