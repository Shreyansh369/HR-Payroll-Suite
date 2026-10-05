"use client";

import { Suspense, use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useM, useQ, errorMessage } from "@/client/api";
import { useSession } from "@/client/session";
import type { ProcOutput } from "@/services/registry";
import type { PayrollInput, PayrollStatus, PreflightIssue } from "@/domain/types";
import { PageHeader, Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, Callout } from "@/components/ui/panel";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormGrid, Input, Select, Textarea, Segmented } from "@/components/ui/form";
import { DataTable, Money, TotalsRow, type Column } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Menu, MenuItem, MenuSeparator, Tooltip } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icon";
import { CalculationDrawer } from "@/components/payroll/calculation-drawer";
import { downloadAllPayslips, downloadPayslip } from "@/components/payroll/payslip-actions";
import { NumberInput } from "@/components/app/form-helpers";
import { formatDate, formatDateTime, formatRange } from "@/lib/dates";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/cn";

type Detail = ProcOutput<"payroll.runs.get">;
type Result = Detail["results"][number];

/** Warnings specific to one employee (run-level rule approval warnings are shown once in pre-flight). */
const ownWarnings = (r: Result) => r.warnings.filter((w) => !w.code.startsWith("RULE_NOT_APPROVED"));

const STEPS: { status: PayrollStatus; label: string }[] = [
  { status: "draft", label: "Draft" },
  { status: "calculated", label: "Calculated" },
  { status: "review", label: "Review" },
  { status: "approved", label: "Approved" },
  { status: "finalized", label: "Finalized" },
  { status: "locked", label: "Locked" },
];

function Stepper({ status }: { status: PayrollStatus }) {
  const idx = STEPS.findIndex((s) => s.status === status);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto text-[12px]" aria-label="Payroll status">
      {STEPS.map((s, i) => (
        <li key={s.status} className="flex shrink-0 items-center gap-1">
          <span
            aria-current={i === idx ? "step" : undefined}
            className={cn("flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-medium", i < idx && "border-accent-line bg-accent-soft text-accent", i === idx && "border-accent bg-accent text-white", i > idx && "border-line bg-surface text-ink-3")}
          >
            {i < idx && <Icon name="check" size="sm" />}
            {s.label}
          </span>
          {i < STEPS.length - 1 && <span className={cn("h-px w-4", i < idx ? "bg-accent-line" : "bg-line")} />}
        </li>
      ))}
    </ol>
  );
}

const CATEGORIES: { value: string; label: string; kind: "earning" | "deduction" }[] = [
  { value: "bonus", label: "Bonus", kind: "earning" },
  { value: "commission", label: "Commission", kind: "earning" },
  { value: "allowance", label: "Allowance", kind: "earning" },
  { value: "overtime", label: "Overtime adjustment (hours)", kind: "earning" },
  { value: "adjustment", label: "Adjustment", kind: "earning" },
  { value: "other", label: "Other earning", kind: "earning" },
  { value: "other", label: "Deduction", kind: "deduction" },
  { value: "advance", label: "Advance recovery", kind: "deduction" },
  { value: "health", label: "Health", kind: "deduction" },
  { value: "union", label: "Union / association", kind: "deduction" },
];

function InputDialog({ detail, employeeId, input, onClose }: { detail: Detail; employeeId?: string; input?: PayrollInput; onClose: () => void }) {
  const toast = useToast();
  const run = detail.run;
  const [emp, setEmp] = useState(input?.employeeId ?? employeeId ?? "");
  const [kind, setKind] = useState<"earning" | "deduction">(input?.kind ?? "earning");
  const [category, setCategory] = useState<string>(input?.category ?? (run.type === "correction" ? "adjustment" : "bonus"));
  const [label, setLabel] = useState(input?.label ?? "");
  const [amount, setAmount] = useState<number | null>(input?.amount ?? null);
  const [hours, setHours] = useState<number | null>(input?.hours ?? null);
  const [taxable, setTaxable] = useState(input?.taxable ?? true);
  const [pretax, setPretax] = useState(input?.pretax ?? false);
  const [note, setNote] = useState(input?.note ?? "");
  const save = useM("payroll.inputs.save", { onSuccess: () => { toast.success(input ? "Item updated" : "Item added", "Recalculate to update the results."); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  const isHours = kind === "earning" && category === "overtime";
  const cats = CATEGORIES.filter((c) => c.kind === kind);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={input ? "Edit one-time item" : run.type === "correction" ? "Add correction adjustment" : "Add one-time item"}
      description={run.type === "correction" ? "Correction runs only pay explicit adjustments. Use a negative amount to recover an overpayment." : "Applies to this payroll only. Recurring items are managed on the employee's Compensation tab."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!emp || !label.trim() || (isHours ? !hours : amount === null)} onClick={() => save.mutate({ runId: run.id, input: { id: input?.id, employeeId: emp, kind, category: category as never, label, amount: isHours ? null : amount, hours: isHours ? hours : null, taxable: kind === "earning" ? taxable : false, pretax: kind === "deduction" ? pretax : false, note } })}>{input ? "Save" : "Add item"}</Button></>}
    >
      <div className="space-y-3.5">
        {save.error && <Callout tone="danger">{save.error.message}</Callout>}
        <Field label="Employee" required>
          <Select value={emp} onChange={(e) => setEmp(e.target.value)} disabled={!!employeeId || !!input}>
            <option value="">Select…</option>
            {detail.employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.code})</option>)}
          </Select>
        </Field>
        <Segmented label="Kind" value={kind} onChange={(v) => { setKind(v); setCategory(v === "earning" ? "bonus" : "other"); }} options={[{ value: "earning", label: "Earning" }, { value: "deduction", label: "Deduction" }]} />
        <FormGrid cols={2}>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {cats.map((c) => <option key={c.label} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          {isHours ? (
            <Field label="Hours" required hint={`Paid at hourly rate × ${detail.settings.overtimeMultiplier}`}><NumberInput value={hours} onChange={setHours} step={0.25} /></Field>
          ) : (
            <Field label="Amount" required><NumberInput value={amount} onChange={setAmount} step="0.01" prefix="$" /></Field>
          )}
          <Field label="Description" required className="sm:col-span-2"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "earning" ? "Q3 performance bonus" : "Uniform replacement"} /></Field>
        </FormGrid>
        {isHours && <Callout tone="neutral">Overtime recorded in approved timesheets is paid automatically. Use this only for adjustments not captured in attendance.</Callout>}
        {kind === "earning" ? <Checkbox label="Taxable" description="Included in statutory contribution bases." checked={taxable} onChange={setTaxable} /> : <Checkbox label="Pre-tax" description="Deducted before taxable remuneration." checked={pretax} onChange={setPretax} />}
        <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
      </div>
    </Dialog>
  );
}

function EmployeesDialog({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const toast = useToast();
  const people = useQ("employees.options", { includeInactive: true });
  const [selected, setSelected] = useState(new Set(detail.run.employeeIds));
  const [search, setSearch] = useState("");
  const save = useM("payroll.runs.setEmployees", { onSuccess: () => { toast.success("Employees updated", "Recalculate to refresh results."); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  const list = (people.data ?? []).filter((p) => !search || `${p.name} ${p.employeeCode}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="Employees in this payroll" description={`${selected.size} selected`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ runId: detail.run.id, employeeIds: [...selected] })}>Save</Button></>}>
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter" className="mb-3" aria-label="Filter employees" />
      <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
        {list.map((p) => (
          <li key={p.id} className="px-3 py-2">
            <Checkbox
              label={<span>{p.name} <span className="text-ink-3">· {p.employeeCode} · {p.position}</span>{p.status !== "active" && <StatusBadge status={p.status} className="ml-2" />}</span>}
              checked={selected.has(p.id)}
              onChange={(v) => setSelected((s) => { const x = new Set(s); if (v) x.add(p.id); else x.delete(p.id); return x; })}
            />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function CorrectionDialog({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { ctx } = useSession();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [payDate, setPayDate] = useState(ctx.today);
  const create = useM("payroll.runs.create", { onSuccess: (r) => { toast.success("Correction run created", "Add the adjustments, then calculate and approve it."); router.push(`/app/payroll/${r.id}`); }, onError: (e) => toast.error("Not created", e.message) });
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={`Correct ${detail.run.name}`}
      description="The original payroll stays locked. A correction run carries explicit adjustment lines with your reason, and its statutory contributions use the original period's rules."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!selected.size || !reason.trim()} loading={create.isPending} onClick={() => create.mutate({ type: "correction", payFrequency: detail.run.payFrequency, periodStart: detail.run.periodStart, periodEnd: detail.run.periodEnd, payDate, correctsRunId: detail.run.id, correctionReason: reason, employeeIds: [...selected] })}>Create correction run</Button></>}
    >
      <div className="space-y-3.5">
        <FormGrid cols={2}>
          <Field label="Reason" required className="sm:col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Commission for September events was omitted" /></Field>
          <Field label="Pay date for the correction"><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
        </FormGrid>
        <p className="text-[12px] font-medium text-ink-2">Employees to correct</p>
        <ul className="max-h-[40vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
          {detail.results.map((r) => (
            <li key={r.employeeId} className="px-3 py-2">
              <Checkbox label={<span>{r.employee.name} <span className="text-ink-3">· net {formatMoney(r.totals.net, detail.currency)}</span></span>} checked={selected.has(r.employeeId)} onChange={(v) => setSelected((s) => { const x = new Set(s); if (v) x.add(r.employeeId); else x.delete(r.employeeId); return x; })} />
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

function PreflightPanel({ detail, canAck }: { detail: Detail; canAck: boolean }) {
  const toast = useToast();
  const ack = useM("payroll.acknowledge", { onError: (e) => toast.error("Not updated", e.message) });
  const [showInfo, setShowInfo] = useState(false);
  const issues = detail.run.preflight.issues;
  const ackd = new Set(detail.run.preflight.acknowledged);
  const editable = ["draft", "calculated", "review"].includes(detail.run.status);
  const name = (id?: string | null) => (id ? detail.employeeNames[id] ?? "" : "Whole payroll");
  const visible = issues.filter((i) => showInfo || i.severity !== "info");
  const warnings = issues.filter((i) => i.severity === "warning");
  const unack = warnings.filter((w) => !ackd.has(w.id));
  if (!detail.run.preflight.ranAt) return null;
  return (
    <Panel>
      <PanelHeader
        title="Pre-flight checks"
        description={
          detail.preflight.errors
            ? `${detail.preflight.errors} error${detail.preflight.errors === 1 ? "" : "s"} block approval`
            : detail.preflight.unacknowledged
              ? `${detail.preflight.unacknowledged} warning${detail.preflight.unacknowledged === 1 ? "" : "s"} need acknowledgement before approval`
              : "Ready for approval"
        }
        actions={
          <>
            <Checkbox label={`Show info (${detail.preflight.info})`} checked={showInfo} onChange={setShowInfo} />
            {canAck && editable && unack.length > 0 && <Button size="sm" onClick={() => ack.mutate({ runId: detail.run.id, issueIds: unack.map((w) => w.id), acknowledged: true })} loading={ack.isPending}>Acknowledge all warnings</Button>}
          </>
        }
      />
      {visible.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-success"><Icon name="success" />No errors or warnings.</div>
      ) : (
        <ul className="max-h-[320px] divide-y divide-line overflow-y-auto scrollbar-thin">
          {visible.map((i: PreflightIssue) => (
            <li key={i.id} className="flex items-start gap-3 px-4 py-2">
              <Badge tone={i.severity === "error" ? "danger" : i.severity === "warning" ? "warning" : "neutral"} className="mt-0.5 w-[62px] justify-center">{i.severity}</Badge>
              <div className="min-w-0 flex-1 text-[12.5px]">
                <span className="font-medium text-ink">{name(i.employeeId)}</span> <span className="text-ink-2">{i.message}</span>
              </div>
              {i.severity === "warning" && (
                <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-3">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={ackd.has(i.id)} disabled={!canAck || !editable || ack.isPending} onChange={(e) => ack.mutate({ runId: detail.run.id, issueIds: [i.id], acknowledged: e.target.checked })} />
                  Acknowledged
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RunDetail({ id }: { id: string }) {
  const { can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const q = useQ("payroll.runs.get", { id });
  const [drawer, setDrawer] = useState<string | null>(params.get("employee"));
  const [inputDialog, setInputDialog] = useState<{ employeeId?: string; input?: PayrollInput } | null>(null);
  const [empDialog, setEmpDialog] = useState(false);
  const [corrDialog, setCorrDialog] = useState(false);
  const [confirm, setConfirm] = useState<null | "approve" | "finalize" | "lock" | "reopen" | "delete">(null);
  const [busyPdf, setBusyPdf] = useState(false);
  const [filter, setFilter] = useState<"all" | "issues" | "changed">("all");

  const ok = (title: string, description?: string) => () => toast.success(title, description);
  const fail = (title: string) => (e: { message: string }) => toast.error(title, e.message);
  const calculate = useM("payroll.calculate", { onSuccess: (r) => toast.success("Payroll calculated", `${r.totals.employees} employees · net ${formatMoney(r.totals.net, q.data?.currency)}. ${r.preflight.errors ? `${r.preflight.errors} error(s) to fix.` : r.preflight.unacknowledged ? `${r.preflight.unacknowledged} warning(s) to review.` : "Pre-flight clear."}`), onError: fail("Calculation failed") });
  const submit = useM("payroll.submitForReview", { onSuccess: ok("Submitted for review"), onError: fail("Not submitted") });
  const approve = useM("payroll.approve", { onSuccess: () => { setConfirm(null); toast.success("Payroll approved"); }, onError: fail("Not approved") });
  const finalize = useM("payroll.finalize", { onSuccess: () => { setConfirm(null); toast.success("Payroll finalized", "Payslips are now visible to employees."); }, onError: fail("Not finalized") });
  const lock = useM("payroll.lock", { onSuccess: () => { setConfirm(null); toast.success("Payroll locked", "Further changes require a correction run."); }, onError: fail("Not locked") });
  const reopen = useM("payroll.reopen", { onSuccess: () => { setConfirm(null); toast.success("Payroll reopened for review"); }, onError: fail("Not reopened") });
  const del = useM("payroll.runs.delete", { onSuccess: () => { toast.success("Payroll deleted"); router.push("/app/payroll"); }, onError: fail("Not deleted") });
  const delInput = useM("payroll.inputs.delete", { onSuccess: ok("Item removed", "Recalculate to update the results."), onError: fail("Not removed") });

  const d = q.data;
  const rows = useMemo(() => {
    if (!d) return [];
    return d.results.filter((r) => filter === "all" || (filter === "issues" ? ownWarnings(r).some((w) => w.severity !== "info") : r.previousNet !== null && Math.abs(r.totals.net - r.previousNet) >= 0.01));
  }, [d, filter]);

  if (q.isLoading) return <LoadingRows rows={12} />;
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />;
  const { run, currency: cur } = d!;
  const t = run.totals;
  const editable = ["draft", "calculated", "review"].includes(run.status);
  const final = run.status === "finalized" || run.status === "locked";
  const prev = d!.previous?.totals;
  const variance = (a: number, b?: number | null) => (b ? ((a - b) / b) * 100 : null);
  const current = drawer ? d!.results.find((r) => r.employeeId === drawer) ?? null : null;

  let primary: React.ReactNode = null;
  if (editable && can("payroll.calculate") && (run.status === "draft" || run.stale)) primary = <Button variant="primary" icon="calculator" loading={calculate.isPending} onClick={() => calculate.mutate({ runId: run.id })}>{run.status === "draft" ? "Calculate" : "Recalculate"}</Button>;
  else if (run.status === "calculated" && can("payroll.calculate")) primary = <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate({ runId: run.id })}>Submit for review</Button>;
  else if (run.status === "review" && can("payroll.approve")) primary = <Tooltip content={d!.preflight.canApprove ? "Approve this payroll" : "Resolve errors and acknowledge warnings first"}><span><Button variant="primary" icon="check" disabled={!d!.preflight.canApprove} onClick={() => setConfirm("approve")}>Approve</Button></span></Tooltip>;
  else if (run.status === "approved" && can("payroll.finalize")) primary = <Button variant="primary" onClick={() => setConfirm("finalize")}>Finalize</Button>;
  else if (run.status === "finalized" && can("payroll.lock")) primary = <Button variant="primary" icon="lock" onClick={() => setConfirm("lock")}>Lock payroll</Button>;

  const columns: Column<Result>[] = [
    {
      key: "emp",
      header: "Employee",
      sortValue: (r) => r.employee.name,
      cell: (r) => (
        <span className="flex min-w-[170px] items-center gap-2">
          <span className="min-w-0">
            <span className="block truncate font-medium">{r.employee.name}</span>
            <span className="block truncate text-[11.5px] text-ink-3">{r.employee.code} · {r.employee.payType === "hourly" ? "Hourly · " : ""}{r.employee.departmentName}</span>
          </span>
          {ownWarnings(r).some((w) => w.severity === "error") ? <Icon name="alert" size="sm" className="text-danger" label="Has errors" /> : ownWarnings(r).some((w) => w.severity === "warning") ? <Icon name="warning" size="sm" className="text-warning" label="Has warnings" /> : null}
        </span>
      ),
    },
    { key: "regular", header: "Regular", align: "right", hideBelow: "md", sortValue: (r) => r.columns.regular, cell: (r) => <Money value={r.columns.regular} currency={cur} /> },
    { key: "ot", header: "Overtime", align: "right", hideBelow: "lg", sortValue: (r) => r.columns.overtime, cell: (r) => <Money value={r.columns.overtime} currency={cur} /> },
    { key: "var", header: "Variable", align: "right", hideBelow: "xl", sortValue: (r) => r.columns.variable, cell: (r) => <Money value={r.columns.variable} currency={cur} /> },
    { key: "unpaid", header: "Unpaid leave", align: "right", hideBelow: "lg", sortValue: (r) => r.columns.unpaidLeave, cell: (r) => <Money value={r.columns.unpaidLeave} currency={cur} /> },
    { key: "gross", header: "Gross", align: "right", sortValue: (r) => r.totals.gross, cell: (r) => <Money value={r.totals.gross} currency={cur} className="font-medium" /> },
    { key: "ded", header: "Deductions", align: "right", hideBelow: "lg", sortValue: (r) => r.columns.deductions, cell: (r) => <Money value={r.columns.deductions ? -r.columns.deductions : 0} currency={cur} /> },
    { key: "stat", header: "Statutory", align: "right", hideBelow: "md", sortValue: (r) => r.columns.statutory, cell: (r) => <Money value={r.columns.statutory ? -r.columns.statutory : 0} currency={cur} /> },
    { key: "net", header: "Net", align: "right", sortValue: (r) => r.totals.net, cell: (r) => <Money value={r.totals.net} currency={cur} className="font-semibold" /> },
    {
      key: "delta",
      header: "Δ prev.",
      align: "right",
      hideBelow: "sm",
      sortValue: (r) => (r.previousNet === null ? null : r.totals.net - r.previousNet),
      cell: (r) => {
        if (r.previousNet === null) return <span className="text-[11.5px] text-ink-4">new</span>;
        const dlt = r.totals.net - r.previousNet;
        if (Math.abs(dlt) < 0.01) return <span className="text-ink-4">—</span>;
        return <span className={cn("text-[12px] num", Math.abs(dlt / (r.previousNet || 1)) > d!.settings.varianceWarningThreshold ? "font-medium text-warning" : "text-ink-2")}>{dlt > 0 ? "+" : "−"}{formatMoney(Math.abs(dlt), cur)}</span>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Payroll", href: "/app/payroll" }, { label: run.name }]}
        title={run.name}
        meta={
          <>
            <StatusBadge status={run.status} />
            {run.type !== "regular" && <Badge tone="info">{run.type === "correction" ? "Correction" : run.type === "off_cycle" ? "Off-cycle" : "Imported"}</Badge>}
            <span className="text-[12.5px] text-ink-2">{formatRange(run.periodStart, run.periodEnd)} · pay date <span className="font-medium text-ink">{formatDate(run.payDate)}</span> · {run.payFrequency.replace("_", "-")}</span>
            {run.stale && <Badge tone="warning">Inputs changed — recalculate</Badge>}
          </>
        }
        actions={
          <>
            {t && (
              <Menu trigger={<Button icon="download" loading={busyPdf}>Payslips</Button>}>
                {[["pdf", "All payslips (one PDF)"], ["zip", "All payslips (ZIP of PDFs)"]].map(([fmt, label]) => (
                  <MenuItem key={fmt} icon={fmt === "zip" ? "zip" : "file"} onSelect={async () => { setBusyPdf(true); try { const n = await downloadAllPayslips(run.id, fmt as "pdf" | "zip"); toast.success(`${n} payslips generated`); } catch (e) { toast.error("Payslips not generated", errorMessage(e)); } finally { setBusyPdf(false); } }}>{label}</MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem icon="chart" onSelect={() => router.push(`/app/reports/payroll_register?runId=${run.id}`)}>Payroll register report</MenuItem>
                {can("accounting.export") && <MenuItem icon="book" onSelect={() => router.push(`/app/accounting?runId=${run.id}`)}>QuickBooks journal</MenuItem>}
              </Menu>
            )}
            {(editable || final) && (
              <Menu trigger={<IconButton icon="more" label="More actions" variant="secondary" />}>
                {editable && can("payroll.create") && <MenuItem icon="users" onSelect={() => setEmpDialog(true)}>Edit employees</MenuItem>}
                {editable && can("payroll.calculate") && run.status !== "draft" && !run.stale && <MenuItem icon="calculator" onSelect={() => calculate.mutate({ runId: run.id })}>Recalculate</MenuItem>}
                {final && can("payroll.correct") && run.type !== "historical" && <MenuItem icon="edit" onSelect={() => setCorrDialog(true)}>Create correction run</MenuItem>}
                {(final || run.status === "approved") && can("payroll.reopen") && run.type !== "historical" && <MenuItem icon="unlock" onSelect={() => setConfirm("reopen")}>Reopen…</MenuItem>}
                {editable && can("payroll.create") && <><MenuSeparator /><MenuItem icon="delete" tone="danger" onSelect={() => setConfirm("delete")}>Delete payroll</MenuItem></>}
              </Menu>
            )}
            {primary}
          </>
        }
      />

      <div className="mb-4 rounded-lg border border-line bg-surface px-4 py-3">
        <Stepper status={run.status} />
      </div>

      {d!.correctsRun && <Callout tone="info" className="mb-4">This is a correction of <Link className="font-medium underline" href={`/app/payroll/${d!.correctsRun.id}`}>{d!.correctsRun.name}</Link>. Reason: {run.correctionReason}</Callout>}
      {d!.corrections.length > 0 && <Callout tone="neutral" className="mb-4">Corrected by {d!.corrections.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link className="font-medium underline" href={`/app/payroll/${c.id}`}>{c.name}</Link> ({c.status})</span>)}</Callout>}
      {run.status === "locked" && <Callout tone="neutral" icon="lock" className="mb-4">Locked {formatDateTime(run.history.find((h) => h.status === "locked")?.at)}. Results cannot be changed; use a correction run for adjustments.</Callout>}
      {d!.mode === "production" && run.status === "approved" && <Callout tone="warning" className="mb-4">Finalizing in production requires every applied statutory rule to be approved.</Callout>}

      {t ? (
        <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4 xl:grid-cols-7">
          {[
            { k: "Employees", v: String(t.employees), sub: prev ? `${prev.employees} previous` : undefined },
            { k: "Gross pay", v: formatMoney(t.gross, cur), sub: variance(t.gross, prev?.gross) !== null ? `${variance(t.gross, prev?.gross)! >= 0 ? "+" : ""}${formatNumber(variance(t.gross, prev?.gross)!, 1)}% vs prev.` : undefined },
            { k: "Employee deductions", v: formatMoney(t.preTaxDeductions + t.postTaxDeductions, cur) },
            { k: "Employee statutory", v: formatMoney(t.employeeStatutory, cur) },
            { k: "Employer statutory", v: formatMoney(t.employerStatutory, cur) },
            { k: "Net pay", v: formatMoney(t.net, cur), sub: variance(t.net, prev?.net) !== null ? `${variance(t.net, prev?.net)! >= 0 ? "+" : ""}${formatNumber(variance(t.net, prev?.net)!, 1)}% vs prev.` : undefined, strong: true },
            { k: "Employer cost", v: formatMoney(t.employerCost, cur) },
          ].map((x) => (
            <div key={x.k} className="bg-surface px-4 py-3">
              <p className="text-[11.5px] text-ink-3">{x.k}</p>
              <p className={cn("mt-0.5 text-[17px] tracking-tight num", x.strong ? "font-semibold text-ink" : "font-medium")}>{x.v}</p>
              {x.sub && <p className="text-[11px] text-ink-3">{x.sub}</p>}
            </div>
          ))}
        </div>
      ) : (
        <Panel className="mb-4">
          <EmptyState icon="calculator" title="Not calculated yet" description={`${run.employeeIds.length} employees are included. Add one-time items such as bonuses or commissions, then calculate. Approved leave, timesheets, recurring items and loans are picked up automatically.`} action={can("payroll.calculate") ? <Button variant="primary" icon="calculator" loading={calculate.isPending} onClick={() => calculate.mutate({ runId: run.id })}>Calculate</Button> : undefined} />
        </Panel>
      )}

      <div className="space-y-4">
        <PreflightPanel detail={d!} canAck={can("payroll.approve") || can("payroll.calculate")} />

        {d!.results.length > 0 && (
          <Panel>
            <PanelHeader
              title="Employees"
              description="Click a row for the full calculation."
              actions={<Segmented size="sm" label="Filter" value={filter} onChange={setFilter} options={[{ value: "all", label: `All (${d!.results.length})` }, { value: "issues", label: "With issues" }, { value: "changed", label: "Changed vs prev." }]} />}
            />
            <DataTable
              dense
              columns={columns}
              rows={rows}
              rowKey={(r) => r.employeeId}
              onRowClick={(r) => setDrawer(r.employeeId)}
              initialSort={{ key: "emp", dir: "asc" }}
              empty={<EmptyState compact title="No employees match this filter" />}
              footer={
                t && filter === "all" ? (
                  <TotalsRow
                    cells={[
                      { content: `Total · ${t.employees}` },
                      { content: formatMoney(d!.results.reduce((s, r) => s + r.columns.regular, 0), cur), align: "right", hideBelow: "md" },
                      { content: formatMoney(d!.results.reduce((s, r) => s + r.columns.overtime, 0), cur), align: "right", hideBelow: "lg" },
                      { content: formatMoney(d!.results.reduce((s, r) => s + r.columns.variable, 0), cur), align: "right", hideBelow: "xl" },
                      { content: formatMoney(d!.results.reduce((s, r) => s + r.columns.unpaidLeave, 0), cur), align: "right", hideBelow: "lg" },
                      { content: formatMoney(t.gross, cur), align: "right" },
                      { content: formatMoney(-(t.preTaxDeductions + t.postTaxDeductions), cur), align: "right", hideBelow: "lg" },
                      { content: formatMoney(-t.employeeStatutory, cur), align: "right", hideBelow: "md" },
                      { content: formatMoney(t.net, cur), align: "right" },
                      { content: "", hideBelow: "sm" },
                    ]}
                  />
                ) : undefined
              }
            />
          </Panel>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel>
            <PanelHeader
              title={run.type === "correction" ? "Correction adjustments" : "One-time items"}
              description={run.type === "correction" ? "Explicit adjustments with the reason above." : "Bonuses, commissions and other items for this payroll only."}
              actions={editable && can("payroll.create") && <Button size="sm" icon="add" onClick={() => setInputDialog({})}>Add item</Button>}
            />
            <DataTable
              dense
              columns={[
                { key: "emp", header: "Employee", cell: (i) => <span className="font-medium">{d!.employeeNames[i.employeeId] ?? "—"}</span> },
                { key: "label", header: "Item", cell: (i) => <span>{i.label}{i.note && <span className="block text-[11.5px] text-ink-3">{i.note}</span>}</span> },
                { key: "kind", header: "", hideBelow: "sm", cell: (i) => (i.kind === "earning" ? <Badge tone="success">Earning</Badge> : <Badge>Deduction</Badge>) },
                { key: "amt", header: "Amount", align: "right", cell: (i) => (i.hours ? `${formatNumber(i.hours)} h` : <Money value={(i.amount ?? 0) * (i.kind === "deduction" ? -1 : 1)} currency={cur} muted0={false} />) },
                { key: "a", header: "", align: "right", cell: (i) => editable && can("payroll.create") && (
                  <Menu trigger={<IconButton icon="more" label="Item actions" size="sm" />}>
                    <MenuItem icon="edit" onSelect={() => setInputDialog({ input: i })}>Edit</MenuItem>
                    <MenuItem icon="delete" tone="danger" onSelect={() => delInput.mutate({ runId: run.id, inputId: i.id })}>Remove</MenuItem>
                  </Menu>
                ) },
              ]}
              rows={run.inputs}
              rowKey={(i) => i.id}
              empty={<EmptyState compact icon="coins" title="No one-time items" description={editable ? "Recurring allowances, deductions, loans, leave and timesheets are included automatically." : undefined} />}
            />
          </Panel>
          <Panel>
            <PanelHeader title="History" />
            <ol className="space-y-3 px-4 py-3">
              {[...run.history].reverse().map((h, i) => (
                <li key={i} className="text-[12.5px]">
                  <p><span className="font-medium capitalize">{h.status}</span> <span className="text-ink-3">· {h.byName}</span></p>
                  <p className="text-[11.5px] text-ink-3">{formatDateTime(h.at)}</p>
                  {h.note && <p className="mt-0.5 text-ink-2">“{h.note}”</p>}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>

      <CalculationDrawer
        result={current}
        currency={cur}
        open={!!current}
        onOpenChange={(o) => !o && setDrawer(null)}
        actions={
          current && (
            <>
              {editable && can("payroll.create") && <Button size="sm" icon="add" onClick={() => setInputDialog({ employeeId: current.employeeId })}>Add item</Button>}
              <Button size="sm" icon="download" onClick={() => downloadPayslip(run.id, current.employeeId).catch((e) => toast.error("Payslip not generated", errorMessage(e)))}>Payslip PDF</Button>
            </>
          )
        }
      />
      {inputDialog && <InputDialog detail={d!} employeeId={inputDialog.employeeId} input={inputDialog.input} onClose={() => setInputDialog(null)} />}
      {empDialog && <EmployeesDialog detail={d!} onClose={() => setEmpDialog(false)} />}
      {corrDialog && <CorrectionDialog detail={d!} onClose={() => setCorrDialog(false)} />}
      <ConfirmDialog open={confirm === "approve"} onOpenChange={(o) => !o && setConfirm(null)} title="Approve payroll?" description={t ? `${t.employees} employees · gross ${formatMoney(t.gross, cur)} · net ${formatMoney(t.net, cur)}. Approval is recorded with your name.` : undefined} confirmLabel="Approve" requireReason reasonLabel="Approval note" loading={approve.isPending} onConfirm={(note) => approve.mutate({ runId: run.id, note })} />
      <ConfirmDialog open={confirm === "finalize"} onOpenChange={(o) => !o && setConfirm(null)} title="Finalize payroll?" description="Results are frozen, payslips become visible to employees, and loan repayments and year-to-date totals are updated." confirmLabel="Finalize" loading={finalize.isPending} onConfirm={() => finalize.mutate({ runId: run.id })} />
      <ConfirmDialog open={confirm === "lock"} onOpenChange={(o) => !o && setConfirm(null)} title="Lock payroll?" description="Locked payrolls cannot be edited. Any later change must be made through a correction run." confirmLabel="Lock payroll" loading={lock.isPending} onConfirm={() => lock.mutate({ runId: run.id })} />
      <ConfirmDialog open={confirm === "reopen"} onOpenChange={(o) => !o && setConfirm(null)} title="Reopen this payroll?" description="Returns the payroll to review so it can be recalculated. Only allowed when no correction exists and no later payroll is finalized. Prefer a correction run for locked payrolls." confirmLabel="Reopen" tone="danger" requireReason loading={reopen.isPending} onConfirm={(reason) => reopen.mutate({ runId: run.id, reason })} />
      <ConfirmDialog open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)} title="Delete this payroll?" description="The run and its calculated results are removed. Leave, timesheets and employee records are not affected." confirmLabel="Delete" tone="danger" requireReason loading={del.isPending} onConfirm={(reason) => del.mutate({ runId: run.id, reason })} />
    </>
  );
}

export default function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <RunDetail id={id} />
    </Suspense>
  );
}
