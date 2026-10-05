"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { LeavePolicyRule, LeaveType } from "@/domain/types";
import { PageHeader, Panel, PanelHeader, EmptyState, LoadingRows, ErrorState } from "@/components/ui/panel";
import { Button, IconButton } from "@/components/ui/button";
import { Tabs, TabPanel } from "@/components/ui/menu";
import { Field, FormGrid, Input, Select, Segmented, Switch, Checkbox } from "@/components/ui/form";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { LeaveRequestsTable, RecordLeaveDialog } from "@/components/hr/leave";
import { NumberInput } from "@/components/app/form-helpers";
import { addMonths, dayOfWeek, eachDay, endOfMonth, monthName, monthOf, startOfMonth, yearOf } from "@/lib/dates";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/cn";

function Requests() {
  const [status, setStatus] = useState<"pending" | "approved" | "all">("pending");
  const q = useQ("leave.requests.list", { status: status === "all" ? undefined : [status], limit: 500 });
  return (
    <Panel>
      <PanelHeader
        title={status === "pending" ? "Awaiting approval" : status === "approved" ? "Approved leave" : "All requests"}
        description={q.data ? `${q.data.length} request${q.data.length === 1 ? "" : "s"}` : undefined}
        actions={<Segmented size="sm" label="Status" value={status} onChange={setStatus} options={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "all", label: "All" }]} />}
      />
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState message={q.error.message} /> : <LeaveRequestsTable rows={q.data!} emptyTitle={status === "pending" ? "No requests waiting for approval" : "No leave requests"} />}
    </Panel>
  );
}

function TeamCalendar() {
  const { ctx } = useSession();
  const [month, setMonth] = useState(startOfMonth(ctx.today));
  const [departmentId, setDept] = useState("");
  const deps = useQ("departments.list", {});
  const from = month;
  const to = endOfMonth(month);
  const q = useQ("leave.calendar", { from, to, departmentId: departmentId || undefined });
  const days = eachDay(from, to);
  const holidays = new Set(q.data?.holidays.map((h) => h.date));
  const rows = useMemo(() => {
    if (!q.data) return [];
    return q.data.employees
      .map((e) => ({ ...e, requests: q.data!.requests.filter((r) => r.employeeId === e.id) }))
      .sort((a, b) => Number(b.requests.length > 0) - Number(a.requests.length > 0) || a.name.localeCompare(b.name));
  }, [q.data]);
  const onLeaveToday = q.data?.requests.filter((r) => r.status === "approved" && r.startDate <= ctx.today && r.endDate >= ctx.today).length ?? 0;

  return (
    <Panel>
      <PanelHeader
        title={`${monthName(monthOf(month), "long")} ${yearOf(month)}`}
        description={month === startOfMonth(ctx.today) ? `${onLeaveToday} on approved leave today` : undefined}
        actions={
          <>
            <Select value={departmentId} onChange={(e) => setDept(e.target.value)} aria-label="Department" className="w-44">
              <option value="">All departments</option>
              {deps.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <IconButton icon="chevronLeft" label="Previous month" variant="secondary" onClick={() => setMonth(addMonths(month, -1))} />
            <Button size="md" onClick={() => setMonth(startOfMonth(ctx.today))}>Today</Button>
            <IconButton icon="chevronRight" label="Next month" variant="secondary" onClick={() => setMonth(addMonths(month, 1))} />
          </>
        }
      />
      {!q.data ? (
        <LoadingRows />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[12px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-48 border-b border-line bg-surface-2 px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">Employee</th>
                {days.map((d) => {
                  const dow = dayOfWeek(d);
                  return (
                    <th key={d} className={cn("border-b border-line px-0 py-1 text-center font-normal", dow === 0 || dow === 6 ? "bg-surface-3 text-ink-4" : "bg-surface-2 text-ink-3", d === ctx.today && "text-accent")} title={holidays.has(d) ? q.data.holidays.find((h) => h.date === d)?.name : undefined}>
                      <div className="text-[10px] uppercase">{"SMTWTFS"[dow]}</div>
                      <div className={cn("num text-[11.5px]", d === ctx.today && "font-bold", holidays.has(d) && "text-warning")}>{+d.slice(8)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="sticky left-0 z-[1] truncate border-b border-line bg-surface px-3 py-1.5">
                    <Link href={`/app/employees/${e.id}`} className="block max-w-[180px] truncate text-[12.5px] font-medium hover:underline">{e.name}</Link>
                  </td>
                  {days.map((d) => {
                    const r = e.requests.find((x) => x.startDate <= d && x.endDate >= d);
                    const dow = dayOfWeek(d);
                    return (
                      <td key={d} className={cn("h-8 border-b border-line p-0.5", (dow === 0 || dow === 6 || holidays.has(d)) && "bg-surface-2")}>
                        {r && (
                          <div
                            className={cn("h-5 rounded-[3px]", r.status === "pending" && "opacity-50 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.5)_3px,rgba(255,255,255,.5)_6px)]")}
                            style={{ background: r.color }}
                            title={`${e.name}: ${r.leaveTypeName} (${r.status})`}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState compact icon="calendar" title="No employees in this view" />}
        </div>
      )}
      {q.data && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3">
          {[...new Map(q.data.requests.map((r) => [r.leaveTypeName, r.color])).entries()].map(([n, c]) => (
            <span key={n} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />{n}</span>
          ))}
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[2px] bg-ink-4 opacity-50" />Pending (striped)</span>
          {q.data.holidays.length > 0 && <span>Holidays: {q.data.holidays.map((h) => `${+h.date.slice(8)} ${h.name}`).join(", ")}</span>}
        </div>
      )}
    </Panel>
  );
}

function Balances() {
  const q = useQ("leave.balances.all", {});
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState message={q.error.message} />;
  const d = q.data!;
  return (
    <Panel>
      <PanelHeader title="Balances" description="Available balance after approved and booked leave. Pending requests are shown separately." />
      <DataTable
        columns={[
          { key: "name", header: "Employee", sortValue: (r) => r.employeeName, cell: (r) => <Link href={`/app/employees/${r.employeeId}`} className="font-medium hover:underline">{r.employeeName}</Link> },
          { key: "dept", header: "Department", hideBelow: "md", sortValue: (r) => r.departmentName, cell: (r) => <span className="text-ink-2">{r.departmentName}</span> },
          ...d.types.map((t, i) => ({
            key: t.id,
            header: t.name,
            align: "right" as const,
            sortValue: (r: (typeof d.rows)[number]) => r.balances[i].available,
            cell: (r: (typeof d.rows)[number]) => {
              const b = r.balances[i];
              return (
                <span className="whitespace-nowrap">
                  <span className={cn("font-medium", b.available < 0 && "text-danger")}>{formatNumber(b.available)}</span>
                  <span className="text-ink-4"> / {formatNumber(b.allocated + b.accrued + b.carriedForward + b.adjustments)}</span>
                  {b.pending > 0 && <span className="ml-1 text-[11px] text-warning">({formatNumber(b.pending)} pending)</span>}
                </span>
              );
            },
          })),
        ]}
        rows={d.rows}
        rowKey={(r) => r.employeeId}
        empty={<EmptyState compact title="No employees" />}
      />
    </Panel>
  );
}

function TypeDialog({ type, onClose }: { type: LeaveType | null; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    code: type?.code ?? "",
    name: type?.name ?? "",
    category: type?.category ?? ("other" as LeaveType["category"]),
    paid: type?.paid ?? true,
    unit: type?.unit ?? ("days" as "days" | "hours"),
    tracksBalance: type?.tracksBalance ?? true,
    requiresApproval: type?.requiresApproval ?? true,
    color: type?.color ?? "#56607a",
    active: type?.active ?? true,
  });
  const save = useM("leave.types.save", { onSuccess: () => { toast.success("Leave type saved"); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={type ? `Edit ${type.name}` : "New leave type"} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.code || !f.name} onClick={() => save.mutate({ id: type?.id, ...f })}>Save</Button></>}>
      <div className="space-y-3.5">
        <FormGrid cols={2}>
          <Field label="Name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Code" required><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={12} /></Field>
          <Field label="Category">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as LeaveType["category"] })}>
              <option value="vacation">Vacation</option><option value="sick">Sick</option><option value="unpaid_sick">Unpaid sick</option><option value="unpaid">Unpaid</option><option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Measured in">
            <Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as "days" | "hours" })}><option value="days">Days</option><option value="hours">Hours</option></Select>
          </Field>
          <Field label="Colour"><Input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-8 p-1" /></Field>
        </FormGrid>
        <Switch label="Paid" description="Unpaid leave is deducted from salaried employees' pay at the daily rate." checked={f.paid} onChange={(v) => setF({ ...f, paid: v })} />
        <Switch label="Track a balance" description="Entitlement, accrual and carry-forward apply." checked={f.tracksBalance} onChange={(v) => setF({ ...f, tracksBalance: v })} />
        <Switch label="Requires approval" checked={f.requiresApproval} onChange={(v) => setF({ ...f, requiresApproval: v })} />
        <Switch label="Active" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </div>
    </Dialog>
  );
}

function PolicyDialog({ policy, types, onClose }: { policy: { id: string; name: string; isDefault: boolean; rules: LeavePolicyRule[] } | null; types: LeaveType[]; onClose: () => void }) {
  const toast = useToast();
  const tracked = types.filter((t) => t.tracksBalance);
  const [name, setName] = useState(policy?.name ?? "");
  const [isDefault, setDefault] = useState(policy?.isDefault ?? false);
  const [rules, setRules] = useState<LeavePolicyRule[]>(() => tracked.map((t) => policy?.rules.find((r) => r.leaveTypeId === t.id) ?? { leaveTypeId: t.id, annualEntitlement: 0, accrual: "upfront", carryForwardMax: 0, carryForwardExpiryMonths: 0 }));
  const save = useM("leave.policies.save", { onSuccess: () => { toast.success("Policy saved"); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  const upd = (i: number, patch: Partial<LeavePolicyRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Dialog open size="xl" onOpenChange={(o) => !o && onClose()} title={policy ? `Edit ${policy.name}` : "New leave policy"} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate({ id: policy?.id, name, isDefault, rules: rules.filter((r) => r.annualEntitlement > 0 || r.carryForwardMax > 0) })}>Save policy</Button></>}>
      <div className="space-y-4">
        <FormGrid cols={2}>
          <Field label="Policy name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="flex items-end pb-1.5"><Checkbox label="Default for new employees" checked={isDefault} onChange={setDefault} /></div>
        </FormGrid>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-ink-3">
              <tr><th className="px-3 py-2 text-left font-medium">Leave type</th><th className="px-3 py-2 text-left font-medium">Annual entitlement</th><th className="px-3 py-2 text-left font-medium">Accrual</th><th className="px-3 py-2 text-left font-medium">Carry forward max</th><th className="px-3 py-2 text-left font-medium">Carry-forward expires</th></tr>
            </thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={r.leaveTypeId} className="border-t border-line">
                  <td className="px-3 py-1.5 font-medium">{tracked[i]?.name}</td>
                  <td className="px-3 py-1.5"><NumberInput value={r.annualEntitlement} onChange={(v) => upd(i, { annualEntitlement: v ?? 0 })} min={0} step={0.5} suffix={tracked[i]?.unit} className="w-28" /></td>
                  <td className="px-3 py-1.5"><Select value={r.accrual} onChange={(e) => upd(i, { accrual: e.target.value as "upfront" | "monthly" })} className="w-36"><option value="upfront">Up front (Jan 1)</option><option value="monthly">Monthly</option></Select></td>
                  <td className="px-3 py-1.5"><NumberInput value={r.carryForwardMax} onChange={(v) => upd(i, { carryForwardMax: v ?? 0 })} min={0} step={0.5} className="w-24" /></td>
                  <td className="px-3 py-1.5"><Select value={String(r.carryForwardExpiryMonths)} onChange={(e) => upd(i, { carryForwardExpiryMonths: Number(e.target.value) })} className="w-36"><option value="0">Never</option>{[1, 2, 3, 4, 5, 6, 9, 12].map((m) => <option key={m} value={m}>End of {monthName(m)}</option>)}</Select></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-ink-3">New hires receive a prorated up-front allocation for the remaining months of the year. Monthly accrual adds 1/12 of the entitlement each month.</p>
      </div>
    </Dialog>
  );
}

function Configure() {
  const toast = useToast();
  const { ctx } = useSession();
  const types = useQ("leave.types.list", { includeInactive: true });
  const policies = useQ("leave.policies.list", {});
  const [editType, setEditType] = useState<LeaveType | null | "new">(null);
  const [editPolicy, setEditPolicy] = useState<{ id: string; name: string; isDefault: boolean; rules: LeavePolicyRule[] } | null | "new">(null);
  const [yearEnd, setYearEnd] = useState(false);
  const nextYear = yearOf(ctx.today) + (monthOf(ctx.today) >= 10 ? 1 : 0);
  const run = useM("leave.yearEnd", { onSuccess: (r) => { toast.success("Year-end processed", `${r.created} ledger entries created, ${r.skipped} already processed.`); setYearEnd(false); }, onError: (e) => toast.error("Year-end failed", e.message) });
  const typeName = new Map(types.data?.map((t) => [t.id, t.name]));
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Leave types" actions={<Button size="sm" icon="add" onClick={() => setEditType("new")}>New type</Button>} />
        {types.data ? (
          <DataTable
            columns={[
              { key: "name", header: "Type", cell: (t) => <span className="flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />{t.name}<span className="font-mono text-[11px] text-ink-3">{t.code}</span></span> },
              { key: "paid", header: "Pay", cell: (t) => (t.paid ? <Badge tone="success">Paid</Badge> : <Badge tone="warning">Unpaid</Badge>) },
              { key: "unit", header: "Unit", hideBelow: "sm", cell: (t) => <span className="capitalize">{t.unit}</span> },
              { key: "bal", header: "Balance", hideBelow: "md", cell: (t) => (t.tracksBalance ? "Tracked" : "—") },
              { key: "appr", header: "Approval", hideBelow: "md", cell: (t) => (t.requiresApproval ? "Required" : "Automatic") },
              { key: "active", header: "", cell: (t) => (t.active ? null : <Badge>Inactive</Badge>) },
              { key: "a", header: "", align: "right", cell: (t) => <Button size="sm" variant="ghost" onClick={() => setEditType(t)}>Edit</Button> },
            ]}
            rows={types.data}
            rowKey={(t) => t.id}
          />
        ) : <LoadingRows />}
      </Panel>
      <Panel>
        <PanelHeader title="Leave policies" actions={<Button size="sm" icon="add" onClick={() => setEditPolicy("new")}>New policy</Button>} />
        {policies.data ? (
          <ul className="divide-y divide-line">
            {policies.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium">{p.name} {p.isDefault && <Badge tone="accent">Default</Badge>}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">{p.rules.map((r) => `${typeName.get(r.leaveTypeId)} ${r.annualEntitlement}${r.accrual === "monthly" ? " (monthly)" : ""}${r.carryForwardMax ? `, carry ${r.carryForwardMax}` : ""}`).join(" · ")}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditPolicy(p)}>Edit</Button>
              </li>
            ))}
          </ul>
        ) : <LoadingRows />}
      </Panel>
      <Panel padded>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13.5px] font-semibold">Year-end processing</p>
            <p className="mt-0.5 text-[12.5px] text-ink-2">Carries forward unused balance (up to each policy&apos;s maximum), expires old carry-forward and allocates the new year&apos;s entitlement. Safe to run more than once.</p>
          </div>
          <Button onClick={() => setYearEnd(true)}>Process year-end for {nextYear}</Button>
        </div>
      </Panel>
      {editType && types.data && <TypeDialog type={editType === "new" ? null : editType} onClose={() => setEditType(null)} />}
      {editPolicy && types.data && <PolicyDialog policy={editPolicy === "new" ? null : editPolicy} types={types.data} onClose={() => setEditPolicy(null)} />}
      <ConfirmDialog open={yearEnd} onOpenChange={setYearEnd} title={`Process year-end into ${nextYear}?`} description="Creates carry-forward, expiry and allocation ledger entries for all current employees." confirmLabel="Process" loading={run.isPending} onConfirm={() => run.mutate({ newYear: nextYear })} />
    </div>
  );
}

function LeavePageInner() {
  const { can } = useSession();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "requests");
  const [recording, setRecording] = useState(params.get("new") === "1");
  const tabs = [
    { value: "requests", label: "Requests" },
    { value: "calendar", label: "Team calendar" },
    { value: "balances", label: "Balances" },
    ...(can("leave.configure") ? [{ value: "configure", label: "Types & policies" }] : []),
  ];
  return (
    <>
      <PageHeader
        title="Leave"
        description="Approve requests, see who is away and manage balances. Approved unpaid leave flows into payroll automatically."
        actions={(can("leave.approve") || can("leave.adjust")) && <Button variant="primary" icon="add" onClick={() => setRecording(true)}>Record leave</Button>}
      />
      <Tabs value={tab} onValueChange={setTab} items={tabs}>
        <TabPanel value="requests" className="pt-4"><Requests /></TabPanel>
        <TabPanel value="calendar" className="pt-4"><TeamCalendar /></TabPanel>
        <TabPanel value="balances" className="pt-4"><Balances /></TabPanel>
        {can("leave.configure") && <TabPanel value="configure" className="pt-4"><Configure /></TabPanel>}
      </Tabs>
      {recording && <RecordLeaveDialog open={recording} onOpenChange={setRecording} />}
    </>
  );
}

export default function LeavePage() {
  return (
    <Suspense>
      <LeavePageInner />
    </Suspense>
  );
}
