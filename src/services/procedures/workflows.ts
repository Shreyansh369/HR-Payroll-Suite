import { z } from "zod";
import type { Workflow } from "@/domain/types";
import { audit, companyToday, idSchema, isoDate, mutation, nonEmpty, nowISO, optionalText, query } from "@/services/core";
import { departmentNames, displayName, getScopedEmployee, scopeWhere } from "@/services/helpers";
import { hasPermission } from "@/services/authz";
import { OFFBOARDING_TEMPLATE, ONBOARDING_TEMPLATE } from "@/config/defaults";
import { addDays, formatDate } from "@/lib/dates";
import { conflict, forbidden, invalidState, notFound, validation } from "@/lib/errors";

const owner = z.enum(["hr", "manager", "employee", "it", "payroll"]);

async function loadWorkflow(ctx: Parameters<typeof getScopedEmployee>[0], id: string): Promise<Workflow> {
  const wf = await ctx.repo.workflows.get(ctx.actor.companyId, id);
  if (!wf) throw notFound("Workflow");
  await getScopedEmployee(ctx, wf.employeeId);
  return wf;
}

export const workflowProcedures = {
  "workflows.list": query({
    input: z.object({ type: z.enum(["onboarding", "offboarding"]).optional(), status: z.enum(["in_progress", "completed", "cancelled"]).optional(), employeeId: idSchema.optional() }),
    permission: ["workflows.manage", "employee.view", "self.view"],
    handler: async (ctx, input) => {
      const manage = hasPermission(ctx.actor, "workflows.manage") || hasPermission(ctx.actor, "employee.view");
      const ids = manage ? scopeWhere(ctx.actor).id : ctx.actor.employeeId ? [ctx.actor.employeeId] : [];
      const [rows, employees, deps] = await Promise.all([
        ctx.repo.workflows.list(ctx.actor.companyId, { where: { type: input.type, status: input.status, employeeId: input.employeeId ?? ids } }),
        ctx.repo.employees.list(ctx.actor.companyId),
        departmentNames(ctx),
      ]);
      const emp = new Map(employees.map((e) => [e.id, e]));
      const today = await companyToday(ctx);
      return rows.map((w) => {
        const e = emp.get(w.employeeId);
        const done = w.tasks.filter((t) => t.done).length;
        return {
          ...w,
          tasks: manage ? w.tasks : w.tasks.filter((t) => t.owner === "employee"),
          employeeName: e ? displayName(e) : "—",
          employeeCode: e?.employeeCode ?? "",
          position: e?.position ?? "",
          departmentName: e?.departmentId ? (deps.get(e.departmentId) ?? "") : "",
          progress: { done, total: w.tasks.length },
          overdue: w.tasks.filter((t) => !t.done && t.dueDate < today).length,
        };
      });
    },
  }),

  "workflows.startOnboarding": mutation({
    input: z.object({ employeeId: idSchema, startDate: isoDate }),
    permission: "workflows.manage",
    handler: async (ctx, input) => {
      const e = await getScopedEmployee(ctx, input.employeeId);
      const existing = await ctx.repo.workflows.list(ctx.actor.companyId, { where: { employeeId: e.id, type: "onboarding", status: "in_progress" } });
      if (existing.length) throw conflict("Onboarding is already in progress for this employee.");
      const now = nowISO(ctx);
      const wf: Workflow = {
        id: ctx.ids("wf"),
        companyId: ctx.actor.companyId,
        employeeId: e.id,
        type: "onboarding",
        status: "in_progress",
        startDate: input.startDate,
        tasks: ONBOARDING_TEMPLATE.map((t) => ({ id: ctx.ids("task"), title: t.title, owner: t.owner, category: t.category, dueDate: addDays(input.startDate, t.offsetDays), done: false })),
        createdBy: ctx.actor.userId,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.repo.workflows.insert(wf);
      await audit(ctx, { action: "onboarding.started", entityType: "workflow", entityId: wf.id, summary: `Started onboarding for ${displayName(e)}` });
      return wf;
    },
  }),

  "workflows.startOffboarding": mutation({
    input: z.object({ employeeId: idSchema, terminationDate: isoDate, reason: nonEmpty(300) }),
    permission: "workflows.manage",
    handler: async (ctx, input) => {
      const e = await getScopedEmployee(ctx, input.employeeId);
      if (e.status === "terminated" || e.status === "archived") throw conflict("This employee has already left.");
      if (input.terminationDate < e.hireDate) throw validation("The termination date cannot be before the hire date.");
      const existing = await ctx.repo.workflows.list(ctx.actor.companyId, { where: { employeeId: e.id, type: "offboarding", status: "in_progress" } });
      if (existing.length) throw conflict("Offboarding is already in progress for this employee.");
      const reports = await ctx.repo.employees.count(ctx.actor.companyId, { where: { managerId: e.id, status: ["active", "on_leave", "onboarding"] } });
      const now = nowISO(ctx);
      const wf: Workflow = {
        id: ctx.ids("wf"),
        companyId: ctx.actor.companyId,
        employeeId: e.id,
        type: "offboarding",
        status: "in_progress",
        startDate: await companyToday(ctx),
        terminationDate: input.terminationDate,
        terminationReason: input.reason,
        tasks: [
          ...OFFBOARDING_TEMPLATE.map((t) => ({ id: ctx.ids("task"), title: t.title, owner: t.owner, category: t.category, dueDate: addDays(input.terminationDate, t.offsetDays), done: false })),
          ...(reports > 0 ? [{ id: ctx.ids("task"), title: `Reassign ${reports} direct report(s)`, owner: "hr" as const, category: "general" as const, dueDate: input.terminationDate, done: false }] : []),
        ],
        createdBy: ctx.actor.userId,
        createdAt: now,
        updatedAt: now,
      };
      await ctx.repo.transaction(async (repo) => {
        await repo.workflows.insert(wf);
        await repo.employees.update(ctx.actor.companyId, e.id, { terminationDate: input.terminationDate, terminationReason: input.reason, updatedAt: now });
        await repo.employmentEvents.insert({ id: ctx.ids("evt"), companyId: ctx.actor.companyId, employeeId: e.id, effectiveDate: input.terminationDate, type: "termination", note: input.reason, createdBy: ctx.actor.userId, createdAt: now, updatedAt: now });
      });
      await audit(ctx, { action: "employee.termination_scheduled", entityType: "employee", entityId: e.id, summary: `Started offboarding for ${displayName(e)}; last day ${formatDate(input.terminationDate)}`, reason: input.reason });
      return wf;
    },
  }),

  "workflows.toggleTask": mutation({
    input: z.object({ workflowId: idSchema, taskId: idSchema, done: z.boolean() }),
    permission: ["workflows.manage", "self.view"],
    handler: async (ctx, input) => {
      const wf = await ctx.repo.workflows.get(ctx.actor.companyId, input.workflowId);
      if (!wf) throw notFound("Workflow");
      const task = wf.tasks.find((t) => t.id === input.taskId);
      if (!task) throw notFound("Task");
      const ownTask = wf.employeeId === ctx.actor.employeeId && task.owner === "employee";
      if (!ownTask) {
        if (!hasPermission(ctx.actor, "workflows.manage")) throw forbidden();
        await getScopedEmployee(ctx, wf.employeeId);
      }
      if (wf.status !== "in_progress") throw invalidState("This checklist is closed.");
      const now = nowISO(ctx);
      const tasks = wf.tasks.map((t) => (t.id === task.id ? { ...t, done: input.done, doneAt: input.done ? now : null, doneBy: input.done ? ctx.actor.userId : null } : t));
      await ctx.repo.workflows.update(ctx.actor.companyId, wf.id, { tasks, updatedAt: now });
      await audit(ctx, { action: `${wf.type}.task_${input.done ? "completed" : "reopened"}`, entityType: "workflow", entityId: wf.id, summary: `${input.done ? "Completed" : "Reopened"} "${task.title}"` });
      return { ok: true };
    },
  }),

  "workflows.addTask": mutation({
    input: z.object({ workflowId: idSchema, title: nonEmpty(150), owner, category: z.enum(["document", "asset", "access", "payroll", "training", "general"]), dueDate: isoDate }),
    permission: "workflows.manage",
    handler: async (ctx, input) => {
      const wf = await loadWorkflow(ctx, input.workflowId);
      if (wf.status !== "in_progress") throw invalidState("This checklist is closed.");
      const task = { id: ctx.ids("task"), title: input.title, owner: input.owner, category: input.category, dueDate: input.dueDate, done: false };
      await ctx.repo.workflows.update(ctx.actor.companyId, wf.id, { tasks: [...wf.tasks, task], updatedAt: nowISO(ctx) });
      await audit(ctx, { action: `${wf.type}.task_added`, entityType: "workflow", entityId: wf.id, summary: `Added task "${input.title}"` });
      return task;
    },
  }),

  "workflows.complete": mutation({
    input: z.object({ workflowId: idSchema, overrideReason: optionalText(300) }),
    permission: "workflows.manage",
    handler: async (ctx, input) => {
      const wf = await loadWorkflow(ctx, input.workflowId);
      if (wf.status !== "in_progress") throw invalidState("This checklist is already closed.");
      const open = wf.tasks.filter((t) => !t.done);
      if (open.length && !input.overrideReason) throw conflict(`${open.length} task(s) are still open. Complete them or give a reason to close anyway.`);
      const e = await getScopedEmployee(ctx, wf.employeeId);
      const today = await companyToday(ctx);
      const now = nowISO(ctx);
      await ctx.repo.transaction(async (repo) => {
        await repo.workflows.update(ctx.actor.companyId, wf.id, { status: "completed", completedAt: now, updatedAt: now });
        if (wf.type === "onboarding" && e.status === "onboarding") {
          await repo.employees.update(ctx.actor.companyId, e.id, { status: "active", updatedAt: now });
        }
        if (wf.type === "offboarding") {
          const terminated = !!e.terminationDate && e.terminationDate <= today;
          if (terminated) await repo.employees.update(ctx.actor.companyId, e.id, { status: "terminated", updatedAt: now });
          // Access deactivation: remove the linked user's membership for this company.
          if (e.userId) {
            const user = await repo.users.get(e.userId);
            if (user) {
              const memberships = user.memberships.filter((m) => m.companyId !== ctx.actor.companyId);
              await repo.users.update(user.id, { memberships, status: memberships.length ? user.status : "disabled", updatedAt: now });
            }
          }
        }
      });
      await audit(ctx, {
        action: `${wf.type}.completed`,
        entityType: "workflow",
        entityId: wf.id,
        summary: `Completed ${wf.type} for ${displayName(e)}${wf.type === "offboarding" && e.userId ? "; system access removed" : ""}`,
        reason: input.overrideReason || null,
      });
      return { ok: true };
    },
  }),

  "workflows.cancel": mutation({
    input: z.object({ workflowId: idSchema, reason: nonEmpty(300) }),
    permission: "workflows.manage",
    handler: async (ctx, input) => {
      const wf = await loadWorkflow(ctx, input.workflowId);
      if (wf.status !== "in_progress") throw invalidState("This checklist is already closed.");
      const now = nowISO(ctx);
      await ctx.repo.transaction(async (repo) => {
        await repo.workflows.update(ctx.actor.companyId, wf.id, { status: "cancelled", updatedAt: now });
        if (wf.type === "offboarding") {
          const e = await repo.employees.get(ctx.actor.companyId, wf.employeeId);
          if (e && e.status !== "terminated") await repo.employees.update(ctx.actor.companyId, e.id, { terminationDate: null, terminationReason: null, updatedAt: now });
          const events = await repo.employmentEvents.list(ctx.actor.companyId, { where: { employeeId: wf.employeeId, type: "termination" } });
          for (const ev of events.filter((x) => x.effectiveDate === wf.terminationDate)) await repo.employmentEvents.remove(ctx.actor.companyId, ev.id);
        }
      });
      await audit(ctx, { action: `${wf.type}.cancelled`, entityType: "workflow", entityId: wf.id, summary: `Cancelled ${wf.type}`, reason: input.reason });
      return { ok: true };
    },
  }),
};
