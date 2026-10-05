"use client";

import { useState } from "react";
import { useM, useQ, errorMessage } from "@/client/api";
import { useSession } from "@/client/session";
import { PageHeader, Panel, PanelHeader, DescriptionList, EmptyState, LoadingRows, Avatar, Callout } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel } from "@/components/ui/menu";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Textarea } from "@/components/ui/form";
import { DataTable, Money } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { LeaveBalanceCards, LeaveRequestsTable, RecordLeaveDialog } from "@/components/hr/leave";
import { DocumentsTable } from "@/components/hr/documents";
import { WorkflowCard } from "@/components/hr/workflows";
import { downloadOwnPayslip } from "@/components/payroll/payslip-actions";
import { NumberInput } from "@/components/app/form-helpers";
import { addDays, formatDate, formatRange, yearOf } from "@/lib/dates";
import { formatMoney, formatNumber } from "@/lib/money";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/labels";

function EditContact({ employee, onClose }: { employee: NonNullable<ReturnType<typeof useProfile>["data"]>["employee"]; onClose: () => void }) {
  const toast = useToast();
  const [preferredName, setPreferred] = useState(employee.preferredName ?? "");
  const [phone, setPhone] = useState(employee.phone);
  const [address, setAddress] = useState({ line1: employee.address.line1, line2: employee.address.line2 ?? "", city: employee.address.city, region: employee.address.region ?? "", postalCode: employee.address.postalCode ?? "", country: employee.address.country });
  const [emergency, setEmergency] = useState({ ...employee.emergencyContact });
  const save = useM("me.updateProfile", { onSuccess: () => { toast.success("Your details were updated"); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="Update my details" description="Name, position, pay and statutory details can only be changed by HR." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ preferredName, phone, address, emergencyContact: emergency })}>Save</Button></>}>
      <FormGrid cols={2}>
        <Field label="Preferred name"><Input value={preferredName} onChange={(e) => setPreferred(e.target.value)} /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} /></Field>
        <Field label="City / town"><Input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} /></Field>
        <Field label="Country"><Input value={address.country} onChange={(e) => setAddress({ ...address, country: e.target.value })} /></Field>
        <Field label="Emergency contact"><Input value={emergency.name} onChange={(e) => setEmergency({ ...emergency, name: e.target.value })} /></Field>
        <Field label="Relationship"><Input value={emergency.relationship} onChange={(e) => setEmergency({ ...emergency, relationship: e.target.value })} /></Field>
        <Field label="Emergency phone"><Input value={emergency.phone} onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })} /></Field>
      </FormGrid>
    </Dialog>
  );
}

function useProfile() {
  return useQ("me.profile", {});
}

function CorrectionDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const [date, setDate] = useState(addDays(ctx.today, -1));
  const [worked, setWorked] = useState<number | null>(8);
  const [ot, setOt] = useState<number | null>(0);
  const [reason, setReason] = useState("");
  const req = useM("attendance.corrections.request", { onSuccess: () => { toast.success("Correction submitted", "Your manager will review it."); onClose(); }, onError: (e) => toast.error("Not submitted", e.message) });
  return (
    <Dialog open size="sm" onOpenChange={(o) => !o && onClose()} title="Request a timesheet correction" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!reason.trim()} loading={req.isPending} onClick={() => req.mutate({ date, requestedWorkedHours: worked ?? 0, requestedOvertimeHours: ot ?? 0, reason })}>Submit</Button></>}>
      <div className="space-y-3.5">
        <Field label="Day"><Input type="date" value={date} max={ctx.today} onChange={(e) => setDate(e.target.value)} /></Field>
        <FormGrid cols={2}>
          <Field label="Hours worked"><NumberInput value={worked} onChange={setWorked} min={0} max={24} step={0.25} /></Field>
          <Field label="Overtime hours"><NumberInput value={ot} onChange={setOt} min={0} max={24} step={0.25} /></Field>
        </FormGrid>
        <Field label="What happened?" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Forgot to clock out after the evening event" /></Field>
      </div>
    </Dialog>
  );
}

export default function MePage() {
  const { ctx, can } = useSession();
  const toast = useToast();
  const profile = useProfile();
  const [tab, setTab] = useState("payslips");
  const [editing, setEditing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const year = yearOf(ctx.today);
  const payslips = useQ("me.payslips", {});
  const ytd = useQ("me.ytd", { year });
  const leave = useQ("leave.requests.list", { employeeId: ctx.employeeId ?? undefined }, { enabled: !!ctx.employeeId });
  const docs = useQ("documents.list", { employeeId: ctx.employeeId ?? undefined }, { enabled: !!ctx.employeeId });
  const companyDocs = useQ("documents.list", {}, { enabled: !!ctx.employeeId && !can("documents.view") });
  const attendance = useQ("attendance.list", { from: addDays(ctx.today, -30), to: ctx.today, employeeId: ctx.employeeId ?? undefined }, { enabled: !!ctx.employeeId });
  const corrections = useQ("attendance.corrections.list", {}, { enabled: !!ctx.employeeId });
  const tasks = useQ("workflows.list", { employeeId: ctx.employeeId ?? undefined, status: "in_progress" }, { enabled: !!ctx.employeeId });

  if (!ctx.employeeId) {
    return (
      <>
        <PageHeader title="My profile" />
        <Panel><EmptyState icon="user" title="No employee record linked" description="Your account isn't linked to an employee in this company. An administrator can link it from Settings → Users." /></Panel>
      </>
    );
  }
  if (profile.isLoading || !profile.data) return <LoadingRows rows={8} />;
  const e = profile.data.employee;
  const name = `${e.preferredName || e.firstName} ${e.lastName}`;
  const myTasks = (tasks.data ?? []).filter((w) => w.tasks.some((t) => t.owner === "employee"));
  const allDocs = [...(docs.data ?? []), ...((companyDocs.data ?? []).filter((d) => d.employeeId === null))];

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-3"><Avatar name={name} size="lg" /><span><span className="block">{name}</span><span className="block text-[13px] font-normal text-ink-2">{e.position} · {profile.data.departmentName} · {ctx.company.tradingName}</span></span></span>}
        actions={
          <>
            <Button icon="edit" onClick={() => setEditing(true)}>Update my details</Button>
            {can("leave.request") && <Button variant="primary" icon="calendar" onClick={() => setRequesting(true)}>Request leave</Button>}
          </>
        }
      />

      {myTasks.length > 0 && (
        <div className="mb-4 space-y-3">
          {myTasks.map((w) => <WorkflowCard key={w.id} workflow={w} />)}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {[
          ["Gross pay, " + year, ytd.data ? formatMoney(ytd.data.gross, ctx.company.currency) : "—"],
          ["Statutory deductions", ytd.data ? formatMoney(ytd.data.employeeStatutory, ctx.company.currency) : "—"],
          ["Net pay, " + year, ytd.data ? formatMoney(ytd.data.net, ctx.company.currency) : "—"],
          ["Payments this year", ytd.data ? String(ytd.data.payments) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface p-4">
            <p className="text-[12px] text-ink-3">{k}</p>
            <p className="mt-1 text-[19px] font-semibold tracking-tight num">{v}</p>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab} items={[{ value: "payslips", label: "Payslips" }, { value: "leave", label: "Leave" }, { value: "attendance", label: "Attendance" }, { value: "documents", label: "Documents" }, { value: "profile", label: "My details" }]}>
        <TabPanel value="payslips" className="pt-4">
          <Panel>
            <PanelHeader title="Payslips" description="Available once payroll is finalized." />
            {!payslips.data ? <LoadingRows /> : (
              <DataTable
                columns={[
                  { key: "date", header: "Pay date", cell: (p) => <span className="num font-medium">{formatDate(p.payDate)}</span> },
                  { key: "period", header: "Period", hideBelow: "sm", cell: (p) => <span className="text-ink-2">{formatRange(p.periodStart, p.periodEnd)}</span> },
                  { key: "type", header: "", hideBelow: "md", cell: (p) => (p.runType === "correction" ? <Badge tone="info">Correction</Badge> : p.runType === "historical" ? <Badge>Imported</Badge> : null) },
                  { key: "gross", header: "Gross", align: "right", cell: (p) => <Money value={p.gross} currency={ctx.company.currency} /> },
                  { key: "net", header: "Net", align: "right", cell: (p) => <Money value={p.net} currency={ctx.company.currency} className="font-semibold" /> },
                  {
                    key: "dl",
                    header: "",
                    align: "right",
                    cell: (p) => p.runType !== "historical" && (
                      <Button size="sm" variant="ghost" icon="download" loading={busy === p.id} onClick={async () => { setBusy(p.id); try { await downloadOwnPayslip(p.id); } catch (err) { toast.error("Payslip not generated", errorMessage(err)); } finally { setBusy(null); } }}>PDF</Button>
                    ),
                  },
                ]}
                rows={payslips.data}
                rowKey={(p) => p.id}
                empty={<EmptyState compact icon="wallet" title="No payslips yet" />}
              />
            )}
          </Panel>
        </TabPanel>
        <TabPanel value="leave" className="pt-4">
          <div className="space-y-4">
            <LeaveBalanceCards employeeId={ctx.employeeId} />
            <Panel>
              <PanelHeader title="My requests" actions={can("leave.request") && <Button size="sm" icon="add" onClick={() => setRequesting(true)}>Request leave</Button>} />
              {leave.data ? <LeaveRequestsTable rows={leave.data} showEmployee={false} emptyTitle="You haven't requested any leave" /> : <LoadingRows />}
            </Panel>
          </div>
        </TabPanel>
        <TabPanel value="attendance" className="pt-4">
          <div className="space-y-4">
            <Panel>
              <PanelHeader title="Last 30 days" actions={<Button size="sm" onClick={() => setCorrecting(true)}>Request correction</Button>} />
              {!attendance.data ? <LoadingRows /> : (
                <DataTable
                  dense
                  columns={[
                    { key: "date", header: "Date", cell: (t) => <span className="num">{formatDate(t.date)}</span> },
                    { key: "w", header: "Worked", align: "right", cell: (t) => (t.absent ? <Badge tone="danger">Absent</Badge> : formatNumber(t.workedHours)) },
                    { key: "ot", header: "Overtime", align: "right", cell: (t) => (t.overtimeHours ? formatNumber(t.overtimeHours) : "—") },
                    { key: "s", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
                  ]}
                  rows={[...attendance.data.entries].reverse()}
                  rowKey={(t) => t.id}
                  empty={<EmptyState compact icon="clock" title="No timesheet entries" description={e.employmentType === "full_time" ? "Salaried staff only record overtime and exceptions." : undefined} />}
                />
              )}
            </Panel>
            {(corrections.data?.length ?? 0) > 0 && (
              <Panel>
                <PanelHeader title="My correction requests" />
                <DataTable dense columns={[{ key: "d", header: "Day", cell: (c) => formatDate(c.date) }, { key: "r", header: "Requested", cell: (c) => `${formatNumber(c.requestedWorkedHours)} h${c.requestedOvertimeHours ? ` + ${formatNumber(c.requestedOvertimeHours)} OT` : ""}` }, { key: "s", header: "Status", cell: (c) => <StatusBadge status={c.status} /> }, { key: "n", header: "Note", hideBelow: "md", cell: (c) => <span className="text-ink-2">{c.decisionNote ?? c.reason}</span> }]} rows={corrections.data!} rowKey={(c) => c.id} />
              </Panel>
            )}
          </div>
        </TabPanel>
        <TabPanel value="documents" className="pt-4">
          <Panel>
            <PanelHeader title="My documents" description="Documents HR has shared with you." />
            <DocumentsTable rows={allDocs} showEmployee={false} />
          </Panel>
        </TabPanel>
        <TabPanel value="profile" className="pt-4">
          <Panel>
            <PanelHeader title="My details" actions={<Button size="sm" icon="edit" onClick={() => setEditing(true)}>Update</Button>} />
            <div className="p-4">
              <DescriptionList
                cols={3}
                items={[
                  { label: "Legal name", value: `${e.firstName} ${e.lastName}` },
                  { label: "Employee ID", value: e.employeeCode },
                  { label: "Date of birth", value: formatDate(e.dateOfBirth) },
                  { label: "Email", value: e.email },
                  { label: "Phone", value: e.phone },
                  { label: "Address", value: [e.address.line1, e.address.city, e.address.country].filter(Boolean).join(", ") },
                  { label: "Position", value: e.position },
                  { label: "Manager", value: profile.data.managerName },
                  { label: "Employment", value: `${EMPLOYMENT_TYPE_LABELS[e.employmentType]} since ${formatDate(e.hireDate)}` },
                  { label: "Emergency contact", value: e.emergencyContact.name ? `${e.emergencyContact.name} (${e.emergencyContact.relationship}) · ${e.emergencyContact.phone}` : "" },
                  { label: "Social Security no.", value: e.statutoryIds.socialSecurityNumber },
                  { label: "Bank account", value: e.payProfile.bankAccount ? `${e.payProfile.bankName} ${e.payProfile.bankAccount}` : "" },
                ]}
              />
              <Callout tone="neutral" className="mt-4">To change your legal name, bank details or statutory numbers, contact HR. Changes you make here are recorded in the audit log.</Callout>
            </div>
          </Panel>
        </TabPanel>
      </Tabs>
      {editing && <EditContact employee={e} onClose={() => setEditing(false)} />}
      {requesting && <RecordLeaveDialog open={requesting} onOpenChange={setRequesting} selfService />}
      {correcting && <CorrectionDialog onClose={() => setCorrecting(false)} />}
    </>
  );
}
