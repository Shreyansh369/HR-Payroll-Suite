"use client";

import { useMemo, useState } from "react";
import { useQ, call } from "@/client/api";
import { useSession } from "@/client/session";
import type { AuditEvent } from "@/domain/types";
import { PageHeader, Panel, LoadingRows, ErrorState, EmptyState, DescriptionList, Callout } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Field, Input, Select, Switch } from "@/components/ui/form";
import { DataTable, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import { rowsToCsv } from "@/lib/export/table-export";
import { saveBlob } from "@/lib/download";

const ENTITY_LABELS: Record<string, string> = {
  employee: "Employee",
  payroll_run: "Payroll run",
  payroll_result: "Payroll result",
  statutory_rule: "Statutory rule",
  leave_request: "Leave request",
  leave_type: "Leave type",
  leave_policy: "Leave policy",
  timesheet: "Timesheet",
  attendance_correction: "Attendance correction",
  document: "Document",
  workflow: "Workflow",
  loan: "Loan",
  company: "Company",
  department: "Department",
  user: "User",
  role: "Role",
  import_batch: "Import",
  journal: "Accounting journal",
  report: "Report export",
  payslip: "Payslip export",
  payslips_bulk: "Bulk payslips",
};

const PAGE_SIZE = 50;

function actionTone(action: string) {
  if (/(deleted|rejected|reopened|disabled|retired|cancel)/.test(action)) return "danger" as const;
  if (/(finalized|locked|approved|created|committed)/.test(action)) return "success" as const;
  if (/(export|login|logout|switch)/.test(action)) return "neutral" as const;
  return "info" as const;
}

/** Flatten nested objects into dotted keys so before/after can be compared line by line. */
function flatten(v: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (v === null || v === undefined || typeof v !== "object") {
    if (prefix) out[prefix] = v === null || v === undefined ? "—" : String(v);
    return out;
  }
  if (Array.isArray(v)) {
    if (v.length === 0 || v.every((x) => typeof x !== "object")) out[prefix] = v.length ? v.join(", ") : "—";
    else v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

function ChangeTable({ before, after }: { before: unknown; after: unknown }) {
  const rows = useMemo(() => {
    const b = flatten(before);
    const a = flatten(after);
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !/(^|\.)(updatedAt|createdAt)$/.test(k));
    const changed = keys.filter((k) => b[k] !== a[k]);
    return (before !== undefined && after !== undefined ? changed : keys).map((k) => ({ key: k, before: b[k], after: a[k] }));
  }, [before, after]);
  if (rows.length === 0) return <p className="text-[12.5px] text-ink-3">No field-level differences were recorded.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[12.5px]">
        <thead className="bg-surface-2 text-left text-[11.5px] text-ink-3">
          <tr><th className="px-3 py-1.5 font-medium">Field</th>{before !== undefined && <th className="px-3 py-1.5 font-medium">Before</th>}{after !== undefined && <th className="px-3 py-1.5 font-medium">After</th>}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.slice(0, 200).map((r) => (
            <tr key={r.key} className="align-top">
              <td className="px-3 py-1.5 font-mono text-[11.5px] text-ink-2">{r.key}</td>
              {before !== undefined && <td className="max-w-[220px] break-words px-3 py-1.5 text-danger">{r.before ?? "—"}</td>}
              {after !== undefined && <td className="max-w-[220px] break-words px-3 py-1.5 text-success">{r.after ?? "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditPage() {
  const { ctx, can } = useSession();
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [allCompanies, setAllCompanies] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const [exporting, setExporting] = useState(false);
  const filters = { search: search.trim() || undefined, entityType: entityType || undefined, from: from || undefined, to: to || undefined, allCompanies };
  const q = useQ("audit.list", { ...filters, page, pageSize: PAGE_SIZE });
  const companyName = new Map(ctx.companies.map((c) => [c.id, c.shortName]));
  const reset = (fn: () => void) => { fn(); setPage(1); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await call("audit.list", { ...filters, page: 1, pageSize: 500 });
      const csv = rowsToCsv(["When (UTC)", "Company", "User", "Action", "Entity", "Entity ID", "Summary", "Reason"], all.items.map((e) => [e.at, e.companyId ? (companyName.get(e.companyId) ?? e.companyId) : "Organisation", e.actorName, e.action, e.entityType, e.entityId ?? "", e.summary, e.reason ?? ""]));
      await call("audit.logExport", { kind: "report", title: "Audit log", format: "csv", rows: all.items.length });
      saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `audit-log-${ctx.today}.csv`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader title="Audit log" description="An append-only record of who changed what and when, including exports and sign-ins. Entries cannot be edited or deleted." actions={<Button icon="download" loading={exporting} onClick={exportCsv}>Export CSV</Button>} />
      <Panel>
        <div className="grid gap-3 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_150px_150px_auto]">
          <Field label="Search"><Input type="search" placeholder="Summary, user or action" value={search} onChange={(e) => reset(() => setSearch(e.target.value))} /></Field>
          <Field label="Record type">
            <Select value={entityType} onChange={(e) => reset(() => setEntityType(e.target.value))}>
              <option value="">All types</option>
              {Object.entries(ENTITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => reset(() => setTo(e.target.value))} /></Field>
          {ctx.companies.length > 1 && <div className="flex items-end pb-1.5"><Switch label="All companies" checked={allCompanies} onChange={(v) => reset(() => setAllCompanies(v))} /></div>}
        </div>
        {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState message={q.error.message} /> : (
          <>
            <DataTable
              dense
              onRowClick={setOpen}
              empty={<EmptyState icon="taskDone" title="No matching activity" description="Try widening the date range or clearing filters." compact />}
              columns={[
                { key: "at", header: "When", cell: (e) => <span className="whitespace-nowrap text-[12px] text-ink-2 num">{formatDateTime(e.at)}</span> },
                { key: "actor", header: "User", cell: (e) => <span className="whitespace-nowrap">{e.actorName}</span> },
                { key: "action", header: "Action", hideBelow: "md", cell: (e) => <Badge tone={actionTone(e.action)}>{e.action.replace(/[._]/g, " ")}</Badge> },
                { key: "summary", header: "Summary", cell: (e) => <span className="line-clamp-2 min-w-[220px]">{e.summary}{e.reason ? <span className="text-ink-3"> — “{e.reason}”</span> : null}</span> },
                ...(allCompanies ? [{ key: "company", header: "Co.", hideBelow: "lg" as const, cell: (e: AuditEvent) => <span className="text-[12px] text-ink-3">{e.companyId ? companyName.get(e.companyId) : "Org"}</span> }] : []),
              ]}
              rows={q.data!.items}
              rowKey={(e) => e.id}
            />
            <Pagination page={page} pageSize={PAGE_SIZE} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </Panel>
      {!can("users.manage") && <p className="mt-3 text-[12px] text-ink-3">Organisation-level events (users and roles) are visible to administrators only.</p>}
      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open ? `${ENTITY_LABELS[open.entityType] ?? open.entityType.replace(/_/g, " ")} · ${open.action.split(".").pop()!.replace(/_/g, " ")}` : ""} description={open ? formatDateTime(open.at) : undefined}>
        {open && (
          <div className="space-y-4">
            <p className="text-[13.5px] font-medium">{open.summary}</p>
            <DescriptionList
              cols={2}
              items={[
                { label: "User", value: open.actorName },
                { label: "Action", value: <code className="font-mono text-[12px]">{open.action}</code> },
                { label: "Record", value: `${ENTITY_LABELS[open.entityType] ?? open.entityType}${open.entityId ? ` · ${open.entityId}` : ""}` },
                { label: "Company", value: open.companyId ? (ctx.companies.find((c) => c.id === open.companyId)?.tradingName ?? open.companyId) : "Organisation" },
                ...(open.reason ? [{ label: "Reason given", value: open.reason, full: true }] : []),
                ...(open.meta?.ip || open.meta?.userAgent ? [{ label: "Client", value: [open.meta?.ip, open.meta?.userAgent].filter(Boolean).join(" · "), full: true }] : []),
              ]}
            />
            {open.before !== undefined || open.after !== undefined ? (
              <div>
                <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">{open.before !== undefined && open.after !== undefined ? "Changed fields" : open.after !== undefined ? "Recorded values" : "Values before change"}</p>
                <ChangeTable before={open.before} after={open.after} />
              </div>
            ) : (
              <Callout tone="neutral">This event has no field-level snapshot.</Callout>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
