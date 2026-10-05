"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { ProcOutput } from "@/services/registry";
import { PageHeader, Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, Callout } from "@/components/ui/panel";
import { Button, IconButton } from "@/components/ui/button";
import { Tabs, TabPanel } from "@/components/ui/menu";
import { Field, FormGrid, Input, Select, Segmented, Checkbox } from "@/components/ui/form";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icon";
import { NumberInput } from "@/components/app/form-helpers";
import { addDays, dayOfWeek, eachDay, formatDate, formatRange, weekdayName } from "@/lib/dates";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/cn";

type Entry = ProcOutput<"attendance.list">["entries"][number];

function mondayOf(d: string) {
  const dow = dayOfWeek(d);
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

function WeekGrid() {
  const toast = useToast();
  const { ctx } = useSession();
  const [weekStart, setWeek] = useState(mondayOf(ctx.today));
  const days = eachDay(weekStart, addDays(weekStart, 6));
  const q = useQ("attendance.list", { from: weekStart, to: addDays(weekStart, 6) });
  const [draft, setDraft] = useState<Record<string, { workedHours: number; overtimeHours: number; absent: boolean }>>({});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset unsaved edits when the week changes
    setDraft({});
  }, [weekStart]);
  const save = useM("attendance.save", { onSuccess: (r) => { toast.success("Timesheets saved", `${r.created} new, ${r.updated} changed — submitted for approval.`); setDraft({}); }, onError: (e) => toast.error("Not saved", e.message) });
  const fill = useM("attendance.fillFromSchedule", { onSuccess: (r) => toast.success(r.created ? `Filled ${r.created} day(s) from schedules` : "Nothing to fill", "Days with leave, holidays or existing entries are skipped."), onError: (e) => toast.error("Not filled", e.message) });
  const byKey = useMemo(() => new Map(q.data?.entries.map((e) => [`${e.employeeId}|${e.date}`, e]) ?? []), [q.data]);
  const canEdit = q.data?.canEdit ?? false;
  const dirty = Object.keys(draft).length;

  const cell = (employeeId: string, date: string) => {
    const k = `${employeeId}|${date}`;
    const e = byKey.get(k);
    const d = draft[k];
    const worked = d ? d.workedHours : e?.workedHours;
    const locked = e?.locked;
    return (
      <td key={date} className={cn("border-b border-line p-1 text-center", (dayOfWeek(date) === 0 || dayOfWeek(date) === 6) && "bg-surface-2", d && "bg-warning-soft/50")}>
        {canEdit && !locked ? (
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={24}
            step={0.25}
            aria-label={`Hours for ${date}`}
            value={worked ?? ""}
            placeholder="–"
            onChange={(ev) => {
              const v = ev.target.value === "" ? 0 : Number(ev.target.value);
              setDraft((x) => ({ ...x, [k]: { workedHours: v, overtimeHours: x[k]?.overtimeHours ?? e?.overtimeHours ?? 0, absent: false } }));
            }}
            className={cn("h-7 w-14 rounded border border-transparent bg-transparent text-center text-[12.5px] num hover:border-line-strong focus:border-accent focus:bg-surface focus:outline-none", e?.status === "approved" && "text-success", e?.absent && "text-danger")}
          />
        ) : (
          <span className={cn("text-[12.5px] num", e?.status === "approved" && "text-success", e?.absent && "text-danger")}>{e ? (e.absent ? "abs" : formatNumber(e.workedHours)) : "–"}{locked && <Icon name="lock" size="sm" className="ml-0.5 inline text-ink-4" />}</span>
        )}
        {(e?.overtimeHours ?? 0) > 0 && <div className="text-[10px] leading-none text-warning">+{formatNumber(e!.overtimeHours)} OT</div>}
      </td>
    );
  };

  return (
    <Panel>
      <PanelHeader
        title={`Week of ${formatRange(weekStart, addDays(weekStart, 6))}`}
        description="Hours entered here are submitted for approval. Approved hours pay hourly employees; approved overtime pays everyone."
        actions={
          <>
            <IconButton icon="chevronLeft" variant="secondary" label="Previous week" onClick={() => setWeek(addDays(weekStart, -7))} />
            <Button onClick={() => setWeek(mondayOf(ctx.today))}>This week</Button>
            <IconButton icon="chevronRight" variant="secondary" label="Next week" onClick={() => setWeek(addDays(weekStart, 7))} />
            {canEdit && <Button icon="calendar" loading={fill.isPending} onClick={() => fill.mutate({ from: weekStart, to: addDays(weekStart, 6) < ctx.today ? addDays(weekStart, 6) : ctx.today })}>Fill from schedules</Button>}
          </>
        }
      />
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState message={q.error.message} /> : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-line bg-surface-2 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">Employee</th>
                {days.map((d) => (
                  <th key={d} className={cn("border-b border-line bg-surface-2 px-1 py-2 text-center text-[11px] font-medium text-ink-3", d === ctx.today && "text-accent")}>
                    {weekdayName(dayOfWeek(d))} <span className="num">{+d.slice(8)}</span>
                  </th>
                ))}
                <th className="border-b border-line bg-surface-2 px-3 py-2 text-right text-[11px] font-medium uppercase text-ink-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.employees.map((emp) => {
                const total = days.reduce((s, d) => s + (draft[`${emp.id}|${d}`]?.workedHours ?? byKey.get(`${emp.id}|${d}`)?.workedHours ?? 0), 0);
                const ot = days.reduce((s, d) => s + (byKey.get(`${emp.id}|${d}`)?.overtimeHours ?? 0), 0);
                return (
                  <tr key={emp.id}>
                    <td className="sticky left-0 z-[1] border-b border-line bg-surface px-3 py-1.5">
                      <Link href={`/app/employees/${emp.id}`} className="block max-w-[200px] truncate font-medium hover:underline">{emp.name}</Link>
                      <span className="block text-[11px] text-ink-3">{emp.departmentName}</span>
                    </td>
                    {days.map((d) => cell(emp.id, d))}
                    <td className="border-b border-line px-3 text-right font-medium num">{formatNumber(total)}{ot > 0 && <span className="block text-[10.5px] font-normal text-warning">+{formatNumber(ot)} OT</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {q.data!.employees.length === 0 && <EmptyState compact icon="clock" title="No employees in this period" />}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5 text-[12px] text-ink-3">
          <span className="flex flex-wrap gap-3">
            <span><span className="text-success">Green</span> = approved</span>
            <span><Icon name="lock" size="sm" className="inline" /> = in a finalized payroll</span>
            <span>Use the Timesheets tab to record overtime, lateness or absences.</span>
          </span>
          <span className="flex gap-2">
            {dirty > 0 && <Button size="sm" variant="ghost" onClick={() => setDraft({})}>Discard</Button>}
            <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ entries: Object.entries(draft).map(([k, v]) => { const [employeeId, date] = k.split("|"); const e = byKey.get(k); return { employeeId, date, workedHours: v.workedHours, overtimeHours: v.overtimeHours, lateMinutes: e?.lateMinutes ?? 0, absent: v.absent, note: e?.note ?? "" }; }) })}>
              Save {dirty || ""} change{dirty === 1 ? "" : "s"}
            </Button>
          </span>
        </div>
      )}
    </Panel>
  );
}

function EntryDialog({ entry, employees, onClose }: { entry: Entry | null; employees: { id: string; name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const [employeeId, setEmp] = useState(entry?.employeeId ?? "");
  const [date, setDate] = useState(entry?.date ?? ctx.today);
  const [workedHours, setWorked] = useState<number | null>(entry?.workedHours ?? 8);
  const [overtimeHours, setOt] = useState<number | null>(entry?.overtimeHours ?? 0);
  const [lateMinutes, setLate] = useState<number | null>(entry?.lateMinutes ?? 0);
  const [absent, setAbsent] = useState(entry?.absent ?? false);
  const [note, setNote] = useState(entry?.note ?? "");
  const save = useM("attendance.save", { onSuccess: () => { toast.success("Entry saved", "Submitted for approval."); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={entry ? "Edit timesheet entry" : "Add timesheet entry"} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!employeeId} onClick={() => save.mutate({ entries: [{ employeeId, date, workedHours: absent ? 0 : workedHours ?? 0, overtimeHours: absent ? 0 : overtimeHours ?? 0, lateMinutes: lateMinutes ?? 0, absent, note }] })}>Save</Button></>}>
      <div className="space-y-3.5">
        {save.error && <Callout tone="danger">{save.error.message}</Callout>}
        {entry?.status === "approved" && <Callout tone="warning">Editing an approved entry returns it to “submitted” for re-approval.</Callout>}
        <FormGrid cols={2}>
          <Field label="Employee" required>
            <Select value={employeeId} onChange={(e) => setEmp(e.target.value)} disabled={!!entry}>
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!!entry} /></Field>
          <Field label="Worked hours"><NumberInput value={workedHours} onChange={setWorked} min={0} max={24} step={0.25} disabled={absent} /></Field>
          <Field label="Overtime hours"><NumberInput value={overtimeHours} onChange={setOt} min={0} max={24} step={0.25} disabled={absent} /></Field>
          <Field label="Late (minutes)"><NumberInput value={lateMinutes} onChange={setLate} min={0} max={600} step={5} /></Field>
        </FormGrid>
        <Checkbox label="Absent" description="Absences without approved leave are flagged in payroll pre-flight." checked={absent} onChange={setAbsent} />
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function Timesheets({ initialStatus }: { initialStatus?: string }) {
  const toast = useToast();
  const { ctx } = useSession();
  const [range, setRange] = useState<"2w" | "month" | "prev">("2w");
  const [status, setStatus] = useState(initialStatus === "submitted" ? "submitted" : "all");
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Entry | null | "new">(null);
  const from = range === "2w" ? addDays(ctx.today, -13) : range === "month" ? `${ctx.today.slice(0, 7)}-01` : addDays(ctx.today, -44);
  const q = useQ("attendance.list", { from, to: ctx.today, status: status === "all" ? undefined : [status as "submitted"] });
  const decide = useM("attendance.decide", { onSuccess: (r, i) => { toast.success(`${i.decision === "approve" ? "Approved" : "Rejected"} ${r.changed} day(s)`); setSelected(new Set()); }, onError: (e) => toast.error("Not updated", e.message) });
  const empName = new Map(q.data?.employees.map((e) => [e.id, e.name]));
  const rows = (q.data?.entries ?? []).filter((e) => !onlyExceptions || e.overtimeHours > 0 || e.absent || e.lateMinutes > 0).slice().reverse();
  return (
    <Panel>
      <PanelHeader
        title="Timesheet entries"
        actions={
          <>
            <Segmented size="sm" label="Range" value={range} onChange={setRange} options={[{ value: "2w", label: "14 days" }, { value: "month", label: "This month" }, { value: "prev", label: "45 days" }]} />
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="w-36"><option value="all">All statuses</option><option value="submitted">Awaiting approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option></Select>
            {q.data?.canEdit && <Button size="sm" icon="add" onClick={() => setEditing("new")}>Add entry</Button>}
          </>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <Checkbox label="Only overtime, lateness and absences" checked={onlyExceptions} onChange={setOnlyExceptions} />
        {q.data?.canApprove && selected.size > 0 && (
          <span className="flex items-center gap-2 text-[12.5px]">
            {selected.size} selected
            <Button size="sm" variant="primary" loading={decide.isPending} onClick={() => decide.mutate({ ids: [...selected], decision: "approve" })}>Approve</Button>
            <Button size="sm" onClick={() => decide.mutate({ ids: [...selected], decision: "reject" })}>Reject</Button>
          </span>
        )}
      </div>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState message={q.error.message} /> : (
        <DataTable
          dense
          maxHeight="max-h-[640px]"
          selection={q.data!.canApprove ? { selected, onChange: setSelected, isSelectable: (e) => e.status === "submitted" && e.employeeId !== ctx.employeeId } : undefined}
          onRowClick={q.data!.canEdit ? (e) => !e.locked && setEditing(e) : undefined}
          columns={[
            { key: "date", header: "Date", cell: (e) => <span className="whitespace-nowrap num">{weekdayName(dayOfWeek(e.date))} {formatDate(e.date)}</span> },
            { key: "emp", header: "Employee", cell: (e) => <span className="font-medium">{empName.get(e.employeeId) ?? "—"}</span> },
            { key: "sched", header: "Scheduled", align: "right", hideBelow: "md", cell: (e) => formatNumber(e.scheduledHours) },
            { key: "worked", header: "Worked", align: "right", cell: (e) => (e.absent ? <Badge tone="danger">Absent</Badge> : formatNumber(e.workedHours)) },
            { key: "ot", header: "Overtime", align: "right", cell: (e) => (e.overtimeHours ? <span className="font-medium text-warning">{formatNumber(e.overtimeHours)}</span> : <span className="text-ink-4">—</span>) },
            { key: "late", header: "Late", align: "right", hideBelow: "sm", cell: (e) => (e.lateMinutes ? `${e.lateMinutes}m` : <span className="text-ink-4">—</span>) },
            { key: "note", header: "Note", hideBelow: "lg", cell: (e) => <span className="block max-w-[220px] truncate text-ink-2">{e.note}</span> },
            { key: "status", header: "Status", cell: (e) => <span className="flex items-center gap-1"><StatusBadge status={e.status} />{e.locked && <Icon name="lock" size="sm" className="text-ink-4" label="In finalized payroll" />}</span> },
          ]}
          rows={rows}
          rowKey={(e) => e.id}
          empty={<EmptyState compact icon="clock" title="No entries in this range" />}
        />
      )}
      {editing && q.data && <EntryDialog entry={editing === "new" ? null : editing} employees={q.data.employees} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function Corrections() {
  const toast = useToast();
  const q = useQ("attendance.corrections.list", {});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const decide = useM("attendance.corrections.decide", { onSuccess: (_, i) => { toast.success(i.decision === "approve" ? "Correction approved and applied" : "Correction rejected"); setRejecting(null); }, onError: (e) => toast.error("Not updated", e.message) });
  return (
    <Panel>
      <PanelHeader title="Correction requests" description="Employees request corrections from self-service; approving one updates the timesheet and marks it approved." />
      {!q.data ? <LoadingRows /> : (
        <DataTable
          columns={[
            { key: "date", header: "Day", cell: (c) => <span className="num">{formatDate(c.date)}</span> },
            { key: "emp", header: "Employee", cell: (c) => <span className="font-medium">{c.employeeName}</span> },
            { key: "req", header: "Requested", cell: (c) => `${formatNumber(c.requestedWorkedHours)} h${c.requestedOvertimeHours ? ` + ${formatNumber(c.requestedOvertimeHours)} OT` : ""}` },
            { key: "reason", header: "Reason", hideBelow: "md", cell: (c) => <span className="block max-w-[320px] text-ink-2">{c.reason}</span> },
            { key: "status", header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
            { key: "a", header: "", align: "right", cell: (c) => c.canDecide && (
              <span className="flex justify-end gap-1.5">
                <Button size="sm" variant="primary" onClick={() => decide.mutate({ id: c.id, decision: "approve", note: "" })}>Approve</Button>
                <Button size="sm" onClick={() => setRejecting(c.id)}>Reject</Button>
              </span>
            ) },
          ]}
          rows={q.data}
          rowKey={(c) => c.id}
          empty={<EmptyState compact icon="edit" title="No correction requests" />}
        />
      )}
      <ConfirmDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} title="Reject correction" confirmLabel="Reject" tone="danger" requireReason reasonLabel="Message to the employee" loading={decide.isPending} onConfirm={(note) => rejecting && decide.mutate({ id: rejecting, decision: "reject", note })} />
    </Panel>
  );
}

function AttendanceInner() {
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? (params.get("status") ? "list" : "week"));
  return (
    <>
      <PageHeader title="Attendance" description="Timesheets feed payroll directly: approved hours pay hourly staff and approved overtime is paid at the company overtime rate. No duplicate payroll entry needed." />
      <Tabs value={tab} onValueChange={setTab} items={[{ value: "week", label: "Weekly timesheet" }, { value: "list", label: "Entries & approvals" }, { value: "corrections", label: "Corrections" }]}>
        <TabPanel value="week" className="pt-4"><WeekGrid /></TabPanel>
        <TabPanel value="list" className="pt-4"><Timesheets initialStatus={params.get("status") ?? undefined} /></TabPanel>
        <TabPanel value="corrections" className="pt-4"><Corrections /></TabPanel>
      </Tabs>
    </>
  );
}

export default function AttendancePage() {
  return (
    <Suspense>
      <AttendanceInner />
    </Suspense>
  );
}
