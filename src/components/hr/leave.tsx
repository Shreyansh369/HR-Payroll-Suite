"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { ProcOutput } from "@/services/registry";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { EmptyState, Callout } from "@/components/ui/panel";
import { Menu, MenuItem } from "@/components/ui/menu";
import { IconButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatRange } from "@/lib/dates";
import { formatNumber } from "@/lib/money";
import { fieldErrors, NumberInput } from "@/components/app/form-helpers";

export type LeaveRow = ProcOutput<"leave.requests.list">[number];

export function RecordLeaveDialog({ open, onOpenChange, employeeId: fixedEmployee, selfService }: { open: boolean; onOpenChange: (o: boolean) => void; employeeId?: string; selfService?: boolean }) {
  const toast = useToast();
  const { ctx, can } = useSession();
  const types = useQ("leave.types.list", {}, { enabled: open });
  const people = useQ("employees.options", { includeInactive: false }, { enabled: open && !selfService && !fixedEmployee && can("employee.view") });
  const [employeeId, setEmployeeId] = useState(fixedEmployee ?? "");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStart] = useState(ctx.today);
  const [endDate, setEnd] = useState(ctx.today);
  const [partial, setPartial] = useState(false);
  const [hours, setHours] = useState<number | null>(4);
  const [reason, setReason] = useState("");
  const [approveNow, setApproveNow] = useState(!selfService && can("leave.approve"));
  const target = fixedEmployee ?? (selfService ? ctx.employeeId : employeeId);
  const balances = useQ("leave.balances", { employeeId: target ?? undefined, asOf: startDate }, { enabled: open && !!target });
  const type = types.data?.find((t) => t.id === leaveTypeId);
  const bal = balances.data?.find((b) => b.leaveTypeId === leaveTypeId);
  const isOther = !!target && target !== ctx.employeeId;

  const create = useM("leave.requests.create", {
    onSuccess: (r) => {
      toast.success(r.request.status === "approved" ? "Leave recorded and approved" : "Leave request submitted", `${formatNumber(r.request.quantity)} ${r.request.quantity === 1 ? r.request.unit.replace(/s$/, "") : r.request.unit} · ${formatRange(r.request.startDate, r.request.endDate)}`);
      if (r.warning) toast.warning("Payroll already finalized", r.warning);
      onOpenChange(false);
      setReason("");
    },
    onError: (e) => toast.error("Leave not saved", e.message),
  });
  const errs = fieldErrors(create.error);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={selfService ? "Request leave" : "Record leave"}
      description={selfService ? "Your manager will be notified to approve it." : "Leave for an employee you manage."}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!leaveTypeId || !target}
            onClick={() =>
              create.mutate({
                employeeId: selfService ? undefined : target || undefined,
                leaveTypeId,
                startDate,
                endDate: partial ? startDate : endDate,
                hours: partial ? hours : null,
                reason,
                approveNow: isOther && approveNow,
              })
            }
          >
            {isOther && approveNow ? "Record and approve" : "Submit request"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {create.error && !Object.keys(errs).length && <Callout tone="danger">{create.error.message}</Callout>}
        {!fixedEmployee && !selfService && (
          <Field label="Employee" required>
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select employee…</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.employeeCode})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Leave type" required>
          <Select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
            <option value="">Select type…</option>
            {types.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.paid ? "" : " (unpaid)"}
              </option>
            ))}
          </Select>
        </Field>
        {type && bal && type.tracksBalance && (
          <p className="text-[12px] text-ink-3">
            Available: <span className="font-medium text-ink num">{formatNumber(bal.available)}</span> {bal.unit}
            {bal.pending > 0 && ` · ${formatNumber(bal.pending)} pending`}
          </p>
        )}
        {type && !type.paid && <Callout tone="warning">Unpaid leave reduces pay for salaried employees: each working day is deducted at the daily rate in the next payroll.</Callout>}
        <Checkbox label="Part of a single day" checked={partial} onChange={setPartial} />
        <FormGrid cols={2}>
          <Field label={partial ? "Date" : "From"} required error={errs.startDate}>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStart(e.target.value);
                if (e.target.value > endDate) setEnd(e.target.value);
              }}
            />
          </Field>
          {partial ? (
            <Field label="Hours" required>
              <NumberInput value={hours} onChange={setHours} min={0.25} max={24} step={0.25} />
            </Field>
          ) : (
            <Field label="To" required error={errs.endDate}>
              <Input type="date" value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          )}
        </FormGrid>
        <p className="text-[12px] text-ink-3">Weekends, non-working days in the employee&apos;s schedule and public holidays are excluded automatically.</p>
        <Field label="Note">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={selfService ? "Optional note for your manager" : "Optional"} />
        </Field>
        {isOther && can("leave.approve") && <Checkbox label="Approve immediately" description="Skip the approval step; recorded in the audit log under your name." checked={approveNow} onChange={setApproveNow} />}
      </div>
    </Dialog>
  );
}

export function LeaveRequestsTable({ rows, showEmployee = true, emptyTitle = "No leave requests" }: { rows: LeaveRow[]; showEmployee?: boolean; emptyTitle?: string }) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState<LeaveRow | null>(null);
  const [cancelling, setCancelling] = useState<LeaveRow | null>(null);
  const decide = useM("leave.requests.decide", {
    onSuccess: (r, input) => {
      toast.success(input.decision === "approve" ? "Leave approved" : "Leave rejected");
      if (r.warning) toast.warning("Payroll already finalized", r.warning);
      setRejecting(null);
    },
    onError: (e) => toast.error("Could not update request", e.message),
  });
  const cancel = useM("leave.requests.cancel", {
    onSuccess: () => {
      toast.success("Leave cancelled");
      setCancelling(null);
    },
    onError: (e) => toast.error("Could not cancel", e.message),
  });

  const columns = useMemo<Column<LeaveRow>[]>(
    () => [
      ...(showEmployee
        ? [
            {
              key: "emp",
              header: "Employee",
              sortValue: (r: LeaveRow) => r.employeeName,
              cell: (r: LeaveRow) => (
                <Link href={`/app/employees/${r.employeeId}`} className="block min-w-[150px]">
                  <span className="block font-medium hover:underline">{r.employeeName}</span>
                  <span className="block text-[11.5px] text-ink-3">{r.departmentName}</span>
                </Link>
              ),
            } satisfies Column<LeaveRow>,
          ]
        : []),
      {
        key: "type",
        header: "Type",
        sortValue: (r) => r.leaveTypeName,
        cell: (r) => (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="h-2 w-2 rounded-full" style={{ background: r.leaveTypeColor }} aria-hidden />
            {r.leaveTypeName}
            {!r.paid && <Badge tone="warning">Unpaid</Badge>}
          </span>
        ),
      },
      { key: "dates", header: "Dates", sortValue: (r) => r.startDate, cell: (r) => <span className="whitespace-nowrap num">{formatRange(r.startDate, r.endDate)}</span> },
      { key: "qty", header: "Amount", align: "right", sortValue: (r) => r.quantity, cell: (r) => `${formatNumber(r.quantity)} ${r.unit === "days" ? (r.quantity === 1 ? "day" : "days") : "h"}` },
      { key: "reason", header: "Note", hideBelow: "lg", cell: (r) => <span className="block max-w-[220px] truncate text-ink-2" title={r.reason}>{r.decisionNote && r.status !== "pending" ? r.decisionNote : r.reason || "—"}</span> },
      { key: "status", header: "Status", sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
      {
        key: "actions",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        cell: (r) => (
          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            {r.canDecide && (
              <>
                <Button size="sm" variant="primary" loading={decide.isPending && decide.variables?.id === r.id && decide.variables?.decision === "approve"} onClick={() => decide.mutate({ id: r.id, decision: "approve", note: "" })}>
                  Approve
                </Button>
                <Button size="sm" onClick={() => setRejecting(r)}>
                  Reject
                </Button>
              </>
            )}
            {r.canCancel && !r.canDecide && (
              <Menu trigger={<IconButton icon="more" label="More actions" size="sm" />}>
                <MenuItem icon="close" tone="danger" onSelect={() => setCancelling(r)}>
                  Cancel {r.status === "approved" ? "approved leave" : "request"}
                </MenuItem>
              </Menu>
            )}
          </div>
        ),
      },
    ],
    [showEmployee, decide],
  );

  return (
    <>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={<EmptyState compact icon="calendar" title={emptyTitle} />} initialSort={{ key: "dates", dir: "desc" }} />
      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject leave request"
        description={rejecting ? `${rejecting.employeeName} · ${rejecting.leaveTypeName} · ${formatRange(rejecting.startDate, rejecting.endDate)}` : undefined}
        confirmLabel="Reject"
        tone="danger"
        requireReason
        reasonLabel="Message to the employee"
        loading={decide.isPending}
        onConfirm={(note) => rejecting && decide.mutate({ id: rejecting.id, decision: "reject", note })}
      />
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={cancelling?.status === "approved" ? "Cancel approved leave" : "Cancel leave request"}
        description={cancelling?.status === "approved" ? "The days are returned to the employee's balance. If an unpaid deduction was already finalized in payroll, use a correction run instead." : undefined}
        confirmLabel="Cancel leave"
        tone="danger"
        requireReason
        loading={cancel.isPending}
        onConfirm={(reason) => cancelling && cancel.mutate({ id: cancelling.id, reason })}
      />
    </>
  );
}

export function LeaveBalanceCards({ employeeId, onAdjust }: { employeeId: string; onAdjust?: () => void }) {
  const q = useQ("leave.balances", { employeeId });
  if (!q.data) return null;
  const tracked = q.data.filter((b) => b.tracksBalance);
  if (tracked.length === 0) return <p className="text-[13px] text-ink-3">No leave policy assigned.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tracked.map((b) => (
        <div key={b.leaveTypeId} className="rounded-lg border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
              <span className="h-2 w-2 rounded-full" style={{ background: b.color }} aria-hidden />
              {b.leaveTypeName}
            </span>
            {onAdjust && (
              <button type="button" className="text-[11.5px] text-ink-3 hover:text-accent" onClick={onAdjust}>
                Adjust
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[22px] font-semibold tracking-tight num">
            {formatNumber(b.available)} <span className="text-[13px] font-normal text-ink-3">{b.unit} available</span>
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px] text-ink-3">
            <dt>Entitlement</dt>
            <dd className="text-right num text-ink-2">{formatNumber(b.allocated + b.accrued)}</dd>
            {b.carriedForward > 0 && (
              <>
                <dt>Carried forward</dt>
                <dd className="text-right num text-ink-2">{formatNumber(b.carriedForward)}</dd>
              </>
            )}
            {b.adjustments !== 0 && (
              <>
                <dt>Adjustments</dt>
                <dd className="text-right num text-ink-2">{formatNumber(b.adjustments)}</dd>
              </>
            )}
            <dt>Taken</dt>
            <dd className="text-right num text-ink-2">{formatNumber(b.taken)}</dd>
            {b.scheduled > 0 && (
              <>
                <dt>Booked</dt>
                <dd className="text-right num text-ink-2">{formatNumber(b.scheduled)}</dd>
              </>
            )}
            {b.pending > 0 && (
              <>
                <dt>Pending approval</dt>
                <dd className="text-right num text-warning">{formatNumber(b.pending)}</dd>
              </>
            )}
          </dl>
        </div>
      ))}
    </div>
  );
}

export function AdjustBalanceDialog({ open, onOpenChange, employeeId }: { open: boolean; onOpenChange: (o: boolean) => void; employeeId: string }) {
  const toast = useToast();
  const { ctx } = useSession();
  const types = useQ("leave.types.list", {}, { enabled: open });
  const [leaveTypeId, setType] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(ctx.today);
  const [reason, setReason] = useState("");
  const adjust = useM("leave.adjust", {
    onSuccess: () => {
      toast.success("Balance adjusted");
      onOpenChange(false);
      setAmount(null);
      setReason("");
    },
    onError: (e) => toast.error("Adjustment not saved", e.message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Adjust leave balance"
      description="Adds a ledger entry. History is never overwritten."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={adjust.isPending} disabled={!leaveTypeId || !amount || !reason.trim()} onClick={() => adjust.mutate({ employeeId, leaveTypeId, amount: amount ?? 0, date, reason })}>
            Save adjustment
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Leave type" required>
          <Select value={leaveTypeId} onChange={(e) => setType(e.target.value)}>
            <option value="">Select…</option>
            {types.data?.filter((t) => t.tracksBalance).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <FormGrid cols={2}>
          <Field label="Amount" required hint="Negative to reduce">
            <NumberInput value={amount} onChange={setAmount} step={0.5} />
          </Field>
          <Field label="Effective date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </FormGrid>
        <Field label="Reason" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Days in lieu for working the gala weekend" />
        </Field>
      </div>
    </Dialog>
  );
}

export function LeaveLedger({ employeeId }: { employeeId: string }) {
  const q = useQ("leave.ledger", { employeeId });
  if (!q.data?.length) return <EmptyState compact icon="calendar" title="No ledger entries" />;
  return (
    <DataTable
      dense
      columns={[
        { key: "date", header: "Date", cell: (l) => <span className="num">{formatDate(l.date)}</span> },
        { key: "type", header: "Type", cell: (l) => l.leaveTypeName },
        { key: "kind", header: "Entry", cell: (l) => <span className="capitalize text-ink-2">{l.kind.replace("_", " ")}</span> },
        { key: "reason", header: "Detail", hideBelow: "md", cell: (l) => <span className="text-ink-2">{l.reason}</span> },
        { key: "amount", header: "Change", align: "right", cell: (l) => <span className={l.amount < 0 ? "text-ink" : "text-success"}>{l.amount > 0 ? "+" : ""}{formatNumber(l.amount)}</span> },
      ]}
      rows={q.data}
      rowKey={(l) => l.id}
    />
  );
}
