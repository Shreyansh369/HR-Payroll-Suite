"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useM, useQ, errorMessage } from "@/client/api";
import { useSession } from "@/client/session";
import { PageHeader, Panel, PanelHeader, DescriptionList, EmptyState, LoadingRows, ErrorState, Avatar, Callout } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Tabs, TabPanel, Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DataTable, Money } from "@/components/ui/table";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icon";
import { EditProfileDialog, OffboardDialog, RecordEventDialog } from "@/components/employee/edit-dialogs";
import { CompensationTab } from "@/components/employee/compensation";
import { AdjustBalanceDialog, LeaveBalanceCards, LeaveLedger, LeaveRequestsTable, RecordLeaveDialog } from "@/components/hr/leave";
import { DocumentsTable, UploadDocumentDialog } from "@/components/hr/documents";
import { WorkflowCard } from "@/components/hr/workflows";
import { downloadPayslip } from "@/components/payroll/payslip-actions";
import { describeWorkDays } from "@/domain/employee/schedule";
import { EMPLOYMENT_TYPE_LABELS, EVENT_LABELS, PAY_METHOD_LABELS, BASIS_SUFFIX } from "@/lib/labels";
import { formatDate, wholeYearsBetween, addDays } from "@/lib/dates";
import { formatMoney, formatNumber } from "@/lib/money";

export default function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { ctx, can } = useSession();
  const q = useQ("employees.get", { id });
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [offboarding, setOffboarding] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const archive = useM("employees.archive", { onSuccess: () => { toast.success("Employee archived"); setArchiving(false); }, onError: (e) => toast.error("Not archived", e.message) });
  const restore = useM("employees.restore", { onSuccess: () => toast.success("Employee restored"), onError: (e) => toast.error("Not restored", e.message) });
  const del = useM("employees.delete", { onSuccess: () => { toast.success("Employee deleted"); router.push("/app/employees"); }, onError: (e) => toast.error("Not deleted", e.message) });

  if (q.isLoading) return <LoadingRows rows={12} />;
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const e = d.employee;
  const name = `${e.preferredName || e.firstName} ${e.lastName}`;
  const tenure = wholeYearsBetween(e.hireDate, ctx.today);
  const leaving = e.terminationDate && e.status !== "terminated" && e.status !== "archived";

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "history", label: "Employment history" },
    ...(d.canSeeSalary && can("salary.view") ? [{ value: "compensation", label: "Compensation" }] : []),
    ...(can("leave.view") ? [{ value: "leave", label: "Leave" }] : []),
    ...(can("attendance.view") ? [{ value: "attendance", label: "Attendance" }] : []),
    ...(can("documents.view") ? [{ value: "documents", label: "Documents" }] : []),
    ...(can("payroll.view") ? [{ value: "payslips", label: "Payslips" }] : []),
    ...(can("workflows.manage") ? [{ value: "checklists", label: "Checklists" }] : []),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Employees", href: "/app/employees" }, { label: name }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={name} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{name}</span>
              <span className="mt-0.5 block text-[13px] font-normal text-ink-2">
                {e.position} · {d.departmentName}
              </span>
            </span>
          </span>
        }
        meta={
          <>
            <StatusBadge status={e.status} />
            <Badge>{e.employeeCode}</Badge>
            <Badge>{EMPLOYMENT_TYPE_LABELS[e.employmentType]}</Badge>
            {leaving && <Badge tone="warning">Last day {formatDate(e.terminationDate)}</Badge>}
            {e.probationEndDate && e.probationEndDate >= ctx.today && <Badge tone="info">Probation until {formatDate(e.probationEndDate)}</Badge>}
          </>
        }
        actions={
          <>
            {can("employee.edit") && e.status !== "archived" && (
              <Button icon="edit" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {(can("employee.edit") || can("workflows.manage") || can("employee.archive") || can("employee.delete")) && (
              <Menu trigger={<Button icon="more" aria-label="More actions">More</Button>}>
                {can("employee.edit") && <MenuItem icon="briefcase" onSelect={() => setRecording(true)}>{e.status === "terminated" || e.status === "archived" ? "Rehire" : "Record employment change"}</MenuItem>}
                {can("leave.approve") && e.status !== "terminated" && e.status !== "archived" && <MenuItem icon="calendar" onSelect={() => setTab("leave")}>Record leave</MenuItem>}
                {can("workflows.manage") && !e.terminationDate && e.status !== "terminated" && e.status !== "archived" && <MenuItem icon="logout" onSelect={() => setOffboarding(true)}>Start offboarding</MenuItem>}
                <MenuSeparator />
                {can("employee.archive") && e.status === "terminated" && <MenuItem icon="folder" onSelect={() => setArchiving(true)}>Archive</MenuItem>}
                {can("employee.archive") && e.status === "archived" && <MenuItem icon="refresh" onSelect={() => restore.mutate({ id })}>Restore from archive</MenuItem>}
                {can("employee.delete") && <MenuItem icon="delete" tone="danger" onSelect={() => setDeleting(true)}>Delete employee</MenuItem>}
              </Menu>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab} items={tabs} className="mb-4">
        <TabPanel value="overview" className="pt-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <Panel>
                <PanelHeader title="Employment" />
                <div className="p-4">
                  <DescriptionList
                    cols={3}
                    items={[
                      { label: "Position", value: e.position },
                      { label: "Department", value: d.departmentName },
                      { label: "Manager", value: e.managerId ? <Link href={`/app/employees/${e.managerId}`} className="text-accent hover:underline">{d.managerName}</Link> : "—" },
                      { label: "Hire date", value: `${formatDate(e.hireDate)}${tenure >= 1 ? ` · ${tenure} yr${tenure === 1 ? "" : "s"}` : ""}` },
                      { label: "Employment type", value: EMPLOYMENT_TYPE_LABELS[e.employmentType] },
                      { label: "Work location", value: e.workLocation },
                      { label: "Schedule", value: d.currentSchedule ? `${describeWorkDays(d.currentSchedule.workDays)} · ${formatNumber(d.currentSchedule.hoursPerDay)} h/day` : "—" },
                      { label: "Leave policy", value: d.leavePolicyName },
                      { label: "Probation ends", value: e.probationEndDate ? formatDate(e.probationEndDate) : "" },
                      ...(e.terminationDate ? [{ label: "Last day", value: `${formatDate(e.terminationDate)}${e.terminationReason ? ` · ${e.terminationReason}` : ""}`, full: true }] : []),
                    ]}
                  />
                </div>
              </Panel>
              <Panel>
                <PanelHeader title="Personal & contact" />
                <div className="p-4">
                  <DescriptionList
                    cols={3}
                    items={[
                      { label: "Legal name", value: `${e.firstName} ${e.lastName}` },
                      { label: "Date of birth", value: e.dateOfBirth ? `${formatDate(e.dateOfBirth)} · age ${wholeYearsBetween(e.dateOfBirth, ctx.today)}` : "" },
                      { label: "Email", value: e.email ? <a className="text-accent hover:underline" href={`mailto:${e.email}`}>{e.email}</a> : "" },
                      { label: "Phone", value: e.phone },
                      { label: "Address", value: [e.address.line1, e.address.city, e.address.country].filter(Boolean).join(", "), full: true },
                      { label: "Emergency contact", value: e.emergencyContact.name ? `${e.emergencyContact.name}${e.emergencyContact.relationship ? ` (${e.emergencyContact.relationship})` : ""} · ${e.emergencyContact.phone}` : "", full: true },
                    ]}
                  />
                </div>
              </Panel>
              <Panel>
                <PanelHeader title="Statutory & pay profile" description={d.canSeeSensitive ? undefined : "Identifiers are masked for your role."} />
                <div className="p-4">
                  <DescriptionList
                    cols={3}
                    items={[
                      { label: "Social Security no.", value: e.statutoryIds.socialSecurityNumber ? <span className="font-mono text-[12.5px]">{e.statutoryIds.socialSecurityNumber}</span> : <span className="text-warning">Missing</span> },
                      { label: "NHI no.", value: e.statutoryIds.nhiNumber ? <span className="font-mono text-[12.5px]">{e.statutoryIds.nhiNumber}</span> : <span className="text-warning">Missing</span> },
                      { label: "Tax ID", value: <span className="font-mono text-[12.5px]">{e.statutoryIds.taxId}</span> },
                      { label: "Pay method", value: PAY_METHOD_LABELS[e.payProfile.payMethod] },
                      { label: "Bank", value: e.payProfile.bankName },
                      { label: "Account", value: e.payProfile.bankAccount ? <span className="font-mono text-[12.5px]">{e.payProfile.bankAccount}</span> : "" },
                      ...(d.canSeeSalary && d.currentRate ? [{ label: "Current pay", value: `${formatMoney(d.currentRate.amount, d.currency)} ${BASIS_SUFFIX[d.currentRate.basis]}` }] : []),
                    ]}
                  />
                </div>
              </Panel>
            </div>
            <div className="space-y-4">
              {d.directReports.length > 0 && (
                <Panel>
                  <PanelHeader title={`Direct reports (${d.directReports.length})`} />
                  <ul className="divide-y divide-line">
                    {d.directReports.map((r) => (
                      <li key={r.id}>
                        <Link href={`/app/employees/${r.id}`} className="flex items-center gap-2.5 px-4 py-2 hover:bg-surface-2">
                          <Avatar name={r.name} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium">{r.name}</span>
                            <span className="block truncate text-[11.5px] text-ink-3">{r.position}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
              <Panel>
                <PanelHeader title="System access" />
                <div className="p-4 text-[13px]">
                  {d.userAccount ? (
                    <p>
                      Signs in as <span className="font-medium">{d.userAccount.email}</span> <StatusBadge status={d.userAccount.status === "active" ? "active" : "inactive"} />
                    </p>
                  ) : (
                    <p className="text-ink-3">No user account linked.{can("users.manage") ? " Link one from Settings → Users to enable self-service." : ""}</p>
                  )}
                </div>
              </Panel>
              {(can("employee.edit") || e.notes.length > 0) && <NotesPanel employeeId={id} notes={e.notes} canEdit={can("employee.edit")} />}
            </div>
          </div>
        </TabPanel>

        <TabPanel value="history" className="pt-4">
          <Timeline employeeId={id} onRecord={can("employee.edit") ? () => setRecording(true) : undefined} />
        </TabPanel>

        {tabs.some((t) => t.value === "compensation") && (
          <TabPanel value="compensation" className="pt-4">
            <CompensationTab employeeId={id} />
          </TabPanel>
        )}
        {can("leave.view") && (
          <TabPanel value="leave" className="pt-4">
            <EmployeeLeave employeeId={id} canRecord={can("leave.approve") || can("leave.adjust")} canAdjust={can("leave.adjust")} />
          </TabPanel>
        )}
        {can("attendance.view") && (
          <TabPanel value="attendance" className="pt-4">
            <EmployeeAttendance employeeId={id} today={ctx.today} />
          </TabPanel>
        )}
        {can("documents.view") && (
          <TabPanel value="documents" className="pt-4">
            <EmployeeDocuments employeeId={id} canUpload={can("documents.upload")} />
          </TabPanel>
        )}
        {can("payroll.view") && (
          <TabPanel value="payslips" className="pt-4">
            <EmployeePayslips employeeId={id} currency={d.currency} />
          </TabPanel>
        )}
        {can("workflows.manage") && (
          <TabPanel value="checklists" className="pt-4">
            <EmployeeChecklists employeeId={id} hireDate={e.hireDate} />
          </TabPanel>
        )}
      </Tabs>

      {editing && <EditProfileDialog employee={e} open={editing} onOpenChange={setEditing} canSensitive={d.canSeeSensitive} />}
      {recording && <RecordEventDialog employee={e} open={recording} onOpenChange={setRecording} />}
      {offboarding && <OffboardDialog employee={e} open={offboarding} onOpenChange={setOffboarding} />}
      <ConfirmDialog open={archiving} onOpenChange={setArchiving} title={`Archive ${name}?`} description="Archived employees are hidden from the directory but their records, documents and payroll history are kept." confirmLabel="Archive" requireReason loading={archive.isPending} onConfirm={(reason) => archive.mutate({ id, reason })} />
      <DeleteEmployeeDialog open={deleting} onOpenChange={setDeleting} code={e.employeeCode} name={name} loading={del.isPending} onConfirm={(confirmCode) => del.mutate({ id, confirmCode })} />
    </>
  );
}

function DeleteEmployeeDialog({ open, onOpenChange, code, name, loading, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; code: string; name: string; loading: boolean; onConfirm: (code: string) => void }) {
  const [typed, setTyped] = useState("");
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped("");
        onOpenChange(o);
      }}
      title={`Delete ${name}?`}
      description="Only employees with no payroll history can be deleted. Their leave, attendance, documents and checklists are removed permanently. Prefer archiving for former employees."
      confirmLabel="Delete permanently"
      tone="danger"
      loading={loading}
      onConfirm={() => onConfirm(typed)}
    >
      <label className="mt-3 block text-[12px] font-medium text-ink-2">
        Type <span className="font-mono">{code}</span> to confirm
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-line-strong px-2.5 font-mono text-[13px]" />
      </label>
    </ConfirmDialog>
  );
}

function NotesPanel({ employeeId, notes, canEdit }: { employeeId: string; notes: { id: string; body: string; createdAt: string; createdByName: string }[]; canEdit: boolean }) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const add = useM("employees.addNote", { onSuccess: () => { setBody(""); toast.success("Note added"); }, onError: (e) => toast.error("Not saved", e.message) });
  const del = useM("employees.deleteNote", { onError: (e) => toast.error("Not deleted", e.message) });
  return (
    <Panel>
      <PanelHeader title="Notes" description="Visible to HR and administrators only." />
      {canEdit && (
        <div className="space-y-2 border-b border-line p-3">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Add a note" aria-label="New note" />
          <div className="flex justify-end">
            <Button size="sm" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate({ employeeId, body })}>
              Add note
            </Button>
          </div>
        </div>
      )}
      {notes.length ? (
        <ul className="divide-y divide-line">
          {notes.map((n) => (
            <li key={n.id} className="group px-4 py-2.5">
              <p className="whitespace-pre-wrap text-[13px]">{n.body}</p>
              <p className="mt-1 flex items-center justify-between text-[11.5px] text-ink-3">
                <span>
                  {n.createdByName} · {formatDate(n.createdAt.slice(0, 10))}
                </span>
                {canEdit && (
                  <button type="button" className="opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus:opacity-100" onClick={() => del.mutate({ employeeId, noteId: n.id })}>
                    Delete
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-[12.5px] text-ink-3">No notes yet.</p>
      )}
    </Panel>
  );
}

function Timeline({ employeeId, onRecord }: { employeeId: string; onRecord?: () => void }) {
  const q = useQ("employees.timeline", { id: employeeId });
  const tone = (k: string) => (k === "hire" || k === "rehire" ? "bg-success" : k === "termination" ? "bg-danger" : k === "salary_change" ? "bg-accent" : k === "promotion" ? "bg-info" : "bg-ink-4");
  return (
    <Panel>
      <PanelHeader title="Employment history" description="Effective-dated events, schedule changes and pay changes (if you can view pay)." actions={onRecord && <Button size="sm" icon="add" onClick={onRecord}>Record change</Button>} />
      {!q.data ? (
        <LoadingRows />
      ) : q.data.length === 0 ? (
        <EmptyState compact title="No history recorded" />
      ) : (
        <ol className="relative px-5 py-4">
          <span className="absolute bottom-4 left-[27px] top-4 w-px bg-line" aria-hidden />
          {q.data.map((it) => (
            <li key={it.id} className="relative flex gap-4 pb-4 last:pb-0">
              <span className={`relative z-[1] mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-surface ${tone(it.kind)}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <span className="font-medium text-ink">{EVENT_LABELS[it.kind as keyof typeof EVENT_LABELS] ?? it.title}</span>
                  <span className="num text-[12px] text-ink-3">{formatDate(it.date)}</span>
                  {it.date > new Date().toISOString().slice(0, 10) && <Badge tone="info">Scheduled</Badge>}
                </p>
                <p className="mt-0.5 text-[12.5px] text-ink-2">{it.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function EmployeeLeave({ employeeId, canRecord, canAdjust }: { employeeId: string; canRecord: boolean; canAdjust: boolean }) {
  const [recording, setRecording] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const reqs = useQ("leave.requests.list", { employeeId });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">Balances</h2>
        <div className="flex gap-2">
          {canAdjust && <Button size="sm" onClick={() => setAdjusting(true)}>Adjust balance</Button>}
          {canRecord && <Button size="sm" variant="primary" icon="add" onClick={() => setRecording(true)}>Record leave</Button>}
        </div>
      </div>
      <LeaveBalanceCards employeeId={employeeId} onAdjust={canAdjust ? () => setAdjusting(true) : undefined} />
      <Panel>
        <PanelHeader title="Requests" />
        {reqs.data ? <LeaveRequestsTable rows={reqs.data} showEmployee={false} /> : <LoadingRows />}
      </Panel>
      <Panel>
        <PanelHeader title="Balance ledger" description="Every allocation, carry-forward, adjustment and day taken." />
        <LeaveLedger employeeId={employeeId} />
      </Panel>
      {recording && <RecordLeaveDialog open={recording} onOpenChange={setRecording} employeeId={employeeId} />}
      {adjusting && <AdjustBalanceDialog open={adjusting} onOpenChange={setAdjusting} employeeId={employeeId} />}
    </div>
  );
}

function EmployeeAttendance({ employeeId, today }: { employeeId: string; today: string }) {
  const from = addDays(today, -45);
  const q = useQ("attendance.list", { from, to: today, employeeId });
  return (
    <Panel>
      <PanelHeader title="Attendance — last 45 days" actions={<Link href="/app/attendance" className="text-[12.5px] font-medium text-accent hover:underline">Open timesheets</Link>} />
      {!q.data ? (
        <LoadingRows />
      ) : (
        <DataTable
          dense
          columns={[
            { key: "date", header: "Date", cell: (t) => <span className="num">{formatDate(t.date)}</span> },
            { key: "sched", header: "Scheduled", align: "right", hideBelow: "sm", cell: (t) => formatNumber(t.scheduledHours) },
            { key: "worked", header: "Worked", align: "right", cell: (t) => (t.absent ? <Badge tone="danger">Absent</Badge> : formatNumber(t.workedHours)) },
            { key: "ot", header: "Overtime", align: "right", cell: (t) => (t.overtimeHours ? formatNumber(t.overtimeHours) : "—") },
            { key: "late", header: "Late", align: "right", hideBelow: "md", cell: (t) => (t.lateMinutes ? `${t.lateMinutes} min` : "—") },
            { key: "note", header: "Note", hideBelow: "lg", cell: (t) => <span className="text-ink-2">{t.note}</span> },
            { key: "status", header: "Status", cell: (t) => <span className="flex items-center gap-1"><StatusBadge status={t.status} />{t.locked && <Icon name="lock" size="sm" className="text-ink-3" />}</span> },
          ]}
          rows={[...q.data.entries].reverse()}
          rowKey={(t) => t.id}
          empty={<EmptyState compact icon="clock" title="No timesheet entries" description="Salaried employees only record overtime or exceptions." />}
        />
      )}
    </Panel>
  );
}

function EmployeeDocuments({ employeeId, canUpload }: { employeeId: string; canUpload: boolean }) {
  const [open, setOpen] = useState(false);
  const q = useQ("documents.list", { employeeId });
  return (
    <Panel>
      <PanelHeader title="Documents" actions={canUpload && <Button size="sm" icon="upload" onClick={() => setOpen(true)}>Upload</Button>} />
      {q.data ? <DocumentsTable rows={q.data} showEmployee={false} /> : <LoadingRows />}
      {open && <UploadDocumentDialog open={open} onOpenChange={setOpen} employeeId={employeeId} />}
    </Panel>
  );
}

function EmployeePayslips({ employeeId, currency }: { employeeId: string; currency: string }) {
  const toast = useToast();
  const q = useQ("payroll.employeeResults", { employeeId });
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Panel>
      <PanelHeader title="Payroll history" description="Results from every payroll this employee was included in." />
      {!q.data ? (
        <LoadingRows />
      ) : (
        <DataTable
          columns={[
            { key: "pay", header: "Pay date", cell: (r) => <span className="num">{formatDate(r.payDate)}</span> },
            { key: "run", header: "Payroll", cell: (r) => <Link className="hover:underline" href={`/app/payroll/${r.runId}?employee=${employeeId}`}>{r.runName}</Link> },
            { key: "status", header: "Status", hideBelow: "sm", cell: (r) => <StatusBadge status={r.status} /> },
            { key: "gross", header: "Gross", align: "right", cell: (r) => <Money value={r.gross} currency={currency} /> },
            { key: "net", header: "Net", align: "right", cell: (r) => <Money value={r.net} currency={currency} className="font-medium" /> },
            {
              key: "pdf",
              header: "",
              align: "right",
              cell: (r) =>
                r.runType !== "historical" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="download"
                    loading={busy === r.id}
                    onClick={async () => {
                      setBusy(r.id);
                      try {
                        await downloadPayslip(r.runId, employeeId);
                      } catch (e) {
                        toast.error("Payslip not generated", errorMessage(e));
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Payslip
                  </Button>
                ),
            },
          ]}
          rows={q.data}
          rowKey={(r) => r.id}
          empty={<EmptyState compact icon="wallet" title="Not yet paid through payroll" />}
        />
      )}
    </Panel>
  );
}

function EmployeeChecklists({ employeeId, hireDate }: { employeeId: string; hireDate: string }) {
  const toast = useToast();
  const q = useQ("workflows.list", { employeeId });
  const start = useM("workflows.startOnboarding", { onSuccess: () => toast.success("Onboarding started"), onError: (e) => toast.error("Not started", e.message) });
  if (!q.data) return <LoadingRows />;
  return (
    <div className="space-y-4">
      {q.data.length === 0 && (
        <Panel>
          <EmptyState compact icon="checklist" title="No checklists" action={<Button size="sm" onClick={() => start.mutate({ employeeId, startDate: hireDate })} loading={start.isPending}>Start onboarding checklist</Button>} />
        </Panel>
      )}
      {q.data.map((w) => (
        <WorkflowCard key={w.id} workflow={w} />
      ))}
      {q.data.length > 0 && !q.data.some((w) => w.type === "onboarding" && w.status === "in_progress") && <Callout tone="neutral">Use the Start offboarding action to begin an exit checklist.</Callout>}
    </div>
  );
}
