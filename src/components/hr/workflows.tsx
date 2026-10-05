"use client";

import { useState } from "react";
import Link from "next/link";
import { useM } from "@/client/api";
import { useSession } from "@/client/session";
import type { ProcOutput } from "@/services/registry";
import type { WorkflowOwner } from "@/domain/types";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { ProgressBar } from "@/components/app/charts";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icon";
import { WORKFLOW_OWNER_LABELS } from "@/config/defaults";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

export type WorkflowRow = ProcOutput<"workflows.list">[number];

export function WorkflowCard({ workflow: w, showEmployee }: { workflow: WorkflowRow; showEmployee?: boolean }) {
  const toast = useToast();
  const { ctx, can } = useSession();
  const [adding, setAdding] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const toggle = useM("workflows.toggleTask", { onError: (e) => toast.error("Not updated", e.message) });
  const complete = useM("workflows.complete", {
    onSuccess: () => {
      toast.success(w.type === "onboarding" ? "Onboarding completed" : "Offboarding completed", w.type === "offboarding" ? "Employment ends on the last day and system access was removed." : "The employee is now active.");
      setCompleting(false);
    },
    onError: (e) => toast.error("Not completed", e.message),
  });
  const cancel = useM("workflows.cancel", { onSuccess: () => { toast.success("Checklist cancelled"); setCancelling(false); }, onError: (e) => toast.error("Not cancelled", e.message) });
  const manage = can("workflows.manage");
  const open = w.tasks.filter((t) => !t.done).length;
  const groups = (Object.keys(WORKFLOW_OWNER_LABELS) as WorkflowOwner[]).map((o) => ({ owner: o, tasks: w.tasks.filter((t) => t.owner === o) })).filter((g) => g.tasks.length);

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={w.type === "onboarding" ? "info" : "neutral"}>{w.type === "onboarding" ? "Onboarding" : "Offboarding"}</Badge>
            {showEmployee ? (
              <Link href={`/app/employees/${w.employeeId}`} className="text-[14px] font-semibold hover:underline">
                {w.employeeName}
              </Link>
            ) : (
              <span className="text-[14px] font-semibold">{w.type === "onboarding" ? "New starter checklist" : "Exit checklist"}</span>
            )}
            <StatusBadge status={w.status} />
          </div>
          <p className="mt-1 text-[12px] text-ink-3">
            {showEmployee && `${w.position} · ${w.departmentName} · `}
            {w.type === "onboarding" ? `Starts ${formatDate(w.startDate)}` : `Last day ${formatDate(w.terminationDate)}${w.terminationReason ? ` · ${w.terminationReason}` : ""}`}
          </p>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <div className="w-full sm:w-40">
            <ProgressBar value={w.progress.done} total={w.progress.total} />
            <p className="mt-1 text-right text-[11.5px] text-ink-3 num">
              {w.progress.done} of {w.progress.total} done{w.overdue ? ` · ${w.overdue} overdue` : ""}
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-x-6 gap-y-4 p-4 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.owner}>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-3">{WORKFLOW_OWNER_LABELS[g.owner]}</p>
            <ul className="space-y-0.5">
              {g.tasks.map((t) => {
                const overdue = !t.done && t.dueDate < ctx.today;
                const canToggle = w.status === "in_progress" && (manage || (t.owner === "employee" && w.employeeId === ctx.employeeId));
                return (
                  <li key={t.id}>
                    <label className={cn("flex items-start gap-2.5 rounded-md px-1.5 py-1 text-[13px]", canToggle && "cursor-pointer hover:bg-surface-2")}>
                      <input
                        type="checkbox"
                        checked={t.done}
                        disabled={!canToggle || toggle.isPending}
                        onChange={(e) => toggle.mutate({ workflowId: w.id, taskId: t.id, done: e.target.checked })}
                        className="mt-0.5 h-4 w-4 accent-accent"
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn(t.done && "text-ink-3 line-through")}>{t.title}</span>
                        <span className={cn("ml-2 text-[11.5px] num", overdue ? "font-medium text-danger" : "text-ink-3")}>{overdue ? "overdue · " : ""}{formatDate(t.dueDate, { year: false })}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {manage && w.status === "in_progress" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5">
          <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-accent">
            <Icon name="add" size="sm" /> Add task
          </button>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>
              Cancel checklist
            </Button>
            <Button size="sm" variant={open === 0 ? "primary" : "secondary"} onClick={() => (open === 0 ? complete.mutate({ workflowId: w.id, overrideReason: "" }) : setCompleting(true))} loading={complete.isPending}>
              Complete {w.type}
            </Button>
          </div>
        </div>
      )}
      {adding && <AddTaskDialog workflowId={w.id} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={completing}
        onOpenChange={setCompleting}
        title={`Complete with ${open} open task${open === 1 ? "" : "s"}?`}
        description={w.type === "offboarding" ? "Completing offboarding removes the employee's system access and marks them terminated once their last day has passed." : "The employee becomes active."}
        confirmLabel="Complete anyway"
        requireReason
        reasonLabel="Why are tasks still open?"
        loading={complete.isPending}
        onConfirm={(reason) => complete.mutate({ workflowId: w.id, overrideReason: reason })}
      />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this checklist?"
        description={w.type === "offboarding" ? "The scheduled last day and termination event are removed. The employee stays employed." : undefined}
        confirmLabel="Cancel checklist"
        tone="danger"
        requireReason
        loading={cancel.isPending}
        onConfirm={(reason) => cancel.mutate({ workflowId: w.id, reason })}
      />
    </Panel>
  );
}

function AddTaskDialog({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<WorkflowOwner>("hr");
  const [category, setCategory] = useState<"document" | "asset" | "access" | "payroll" | "training" | "general">("general");
  const [dueDate, setDue] = useState(ctx.today);
  const add = useM("workflows.addTask", { onSuccess: () => { toast.success("Task added"); onClose(); }, onError: (e) => toast.error("Not added", e.message) });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add task"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!title.trim()} loading={add.isPending} onClick={() => add.mutate({ workflowId, title, owner, category, dueDate })}>Add task</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Task" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Issue uniform" />
        </Field>
        <FormGrid cols={2}>
          <Field label="Owner">
            <Select value={owner} onChange={(e) => setOwner(e.target.value as WorkflowOwner)}>
              {Object.entries(WORKFLOW_OWNER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              {["document", "asset", "access", "payroll", "training", "general"].map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </Select>
          </Field>
        </FormGrid>
        <Field label="Due">
          <Input type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
