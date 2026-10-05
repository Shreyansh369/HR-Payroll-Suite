"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { call, useM, useQ, errorMessage } from "@/client/api";
import { useSession } from "@/client/session";
import type { AccountKey } from "@/domain/types";
import { PageHeader, Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, Callout } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Select } from "@/components/ui/form";
import { DataTable, Money, TotalsRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabPanel, Menu, MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { ACCOUNT_LABELS } from "@/config/defaults";
import { rowsToCsv } from "@/lib/export/table-export";
import { saveBlob, slug } from "@/lib/download";
import { formatMoney } from "@/lib/money";

function Journal({ initialRun }: { initialRun: string | null }) {
  const toast = useToast();
  const { ctx } = useSession();
  const runs = useQ("payroll.runs.list", {});
  const options = (runs.data ?? []).filter((r) => r.totals && r.type !== "historical");
  const [runId, setRunId] = useState(initialRun ?? "");
  const [mode, setMode] = useState<"summary" | "detailed">("summary");
  const effective = runId || options.find((r) => r.status === "finalized" || r.status === "locked")?.id || options[0]?.id || "";
  const q = useQ("accounting.journal", { runId: effective, mode }, { enabled: !!effective });
  const j = q.data;
  const cur = ctx.company.currency;

  async function exportAs(format: "csv" | "xlsx") {
    if (!j) return;
    try {
      const headers = ["JournalNo", "JournalDate", "AccountName", "Debits", "Credits", "Description", "Name"];
      const rows = j.lines.map((l) => [j.journalNo, l.date, l.accountCode ? `${l.accountName}` : l.accountName, l.debit ? l.debit.toFixed(2) : "", l.credit ? l.credit.toFixed(2) : "", l.description, l.name]);
      const base = `quickbooks-journal-${slug(j.run.name)}-${mode}`;
      if (format === "csv") saveBlob(rowsToCsv(headers, rows), `${base}.csv`, "text/csv;charset=utf-8");
      else {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Journal");
        ws.addRow([...headers, "AccountCode"]).font = { bold: true };
        j.lines.forEach((l) => ws.addRow([j.journalNo, l.date, l.accountName, l.debit || null, l.credit || null, l.description, l.name, l.accountCode]));
        ws.columns.forEach((c, i) => (c.width = [12, 12, 40, 12, 12, 50, 24, 12][i]));
        saveBlob(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer), `${base}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      }
      await call("accounting.logJournalExport", { runId: j.run.id, mode, format });
      toast.success("Journal exported", "Import it in QuickBooks Online under Settings → Import data → Journal entries.");
    } catch (e) {
      toast.error("Export failed", errorMessage(e));
    }
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-3 p-3">
          <Field label="Payroll run" className="min-w-[300px]">
            <Select value={effective} onChange={(e) => setRunId(e.target.value)}>
              {options.length === 0 && <option value="">No calculated payroll</option>}
              {options.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.status})</option>)}
            </Select>
          </Field>
          <Segmented label="Detail" value={mode} onChange={setMode} options={[{ value: "summary", label: "Summary" }, { value: "detailed", label: "Per employee" }]} />
          <div className="ml-auto">
            <Menu trigger={<Button variant="primary" icon="download" disabled={!j || !j.balanced}>Export journal</Button>}>
              <MenuItem icon="file" onSelect={() => exportAs("csv")} hint="QuickBooks import">CSV</MenuItem>
              <MenuItem icon="file" onSelect={() => exportAs("xlsx")}>XLSX</MenuItem>
            </Menu>
          </div>
        </div>
      </Panel>
      {j && !j.finalized && <Callout tone="warning">This payroll is not finalized yet. Export the journal after finalizing so the figures match what was paid.</Callout>}
      <Panel>
        <PanelHeader
          title={j ? `Journal ${j.journalNo}` : "Journal"}
          description={j ? `${j.run.name} · dated ${j.run.payDate}` : undefined}
          actions={j && (j.balanced ? <Badge tone="success" dot>Balanced · {formatMoney(j.debits, cur)}</Badge> : <Badge tone="danger" dot>Out of balance</Badge>)}
        />
        {!effective ? <EmptyState icon="book" title="No calculated payroll yet" /> : q.isLoading ? <LoadingRows /> : q.error ? <ErrorState message={q.error.message} /> : (
          <DataTable
            dense
            columns={[
              { key: "acct", header: "Account", cell: (l) => <span><span className="font-medium">{l.accountName}</span>{l.accountCode && <span className="ml-2 font-mono text-[11.5px] text-ink-3">{l.accountCode}</span>}</span> },
              ...(mode === "detailed" ? [{ key: "name", header: "Employee", cell: (l: NonNullable<typeof j>["lines"][number]) => l.name }] : []),
              { key: "desc", header: "Description", hideBelow: "lg", cell: (l) => <span className="text-ink-2">{l.description}</span> },
              { key: "dr", header: "Debit", align: "right", cell: (l) => (l.debit ? <Money value={l.debit} currency={cur} /> : "") },
              { key: "cr", header: "Credit", align: "right", cell: (l) => (l.credit ? <Money value={l.credit} currency={cur} /> : "") },
            ]}
            rows={j!.lines}
            rowKey={(l) => `${l.account}|${l.name}`}
            footer={<TotalsRow cells={[{ content: "Totals" }, ...(mode === "detailed" ? [{ content: "" }] : []), { content: "", hideBelow: "lg" }, { content: formatMoney(j!.debits, cur), align: "right" }, { content: formatMoney(j!.credits, cur), align: "right" }]} />}
          />
        )}
      </Panel>
      <p className="text-[12px] text-ink-3">Export-only: no connection to QuickBooks is made. The CSV follows the QuickBooks Online journal entry import layout (JournalNo, JournalDate, AccountName, Debits, Credits, Description, Name). Account names must match your chart of accounts.</p>
    </div>
  );
}

function Mappings() {
  const toast = useToast();
  const company = useQ("company.get", {});
  const [rows, setRows] = useState<{ key: AccountKey; accountName: string; accountCode: string }[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load server values into the editable form
    if (company.data) setRows(company.data.accountMappings.map((m) => ({ ...m })));
  }, [company.data]);
  const save = useM("company.updateAccountMappings", { onSuccess: () => toast.success("Account mapping saved"), onError: (e) => toast.error("Not saved", e.message) });
  if (!company.data) return <LoadingRows />;
  return (
    <Panel>
      <PanelHeader title="Account mapping" description="Map each payroll component to an account in your chart of accounts." actions={<Button variant="primary" size="sm" loading={save.isPending} onClick={() => save.mutate({ accountMappings: rows })}>Save mapping</Button>} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-ink-3"><tr><th className="px-4 py-2 text-left font-medium">Payroll component</th><th className="px-4 py-2 text-left font-medium">Account name</th><th className="px-4 py-2 text-left font-medium">Code</th></tr></thead>
          <tbody>
            {rows.map((m, i) => (
              <tr key={m.key} className="border-t border-line">
                <td className="px-4 py-1.5 text-ink-2">{ACCOUNT_LABELS[m.key]}</td>
                <td className="px-4 py-1.5"><Input value={m.accountName} onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, accountName: e.target.value } : r)))} aria-label={`${ACCOUNT_LABELS[m.key]} account name`} /></td>
                <td className="w-32 px-4 py-1.5"><Input value={m.accountCode} onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, accountCode: e.target.value } : r)))} aria-label={`${ACCOUNT_LABELS[m.key]} account code`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AccountingInner() {
  const params = useSearchParams();
  const { can } = useSession();
  const [tab, setTab] = useState("journal");
  return (
    <>
      <PageHeader title="Accounting export" description="QuickBooks-ready journal entries for each payroll, built from your account mapping." />
      <Tabs value={tab} onValueChange={setTab} items={[{ value: "journal", label: "Journal" }, ...(can("company.manage") || can("accounting.export") ? [{ value: "mapping", label: "Account mapping" }] : [])]}>
        <TabPanel value="journal" className="pt-4"><Journal initialRun={params.get("runId")} /></TabPanel>
        <TabPanel value="mapping" className="pt-4"><Mappings /></TabPanel>
      </Tabs>
    </>
  );
}

export default function AccountingPage() {
  return (
    <Suspense>
      <AccountingInner />
    </Suspense>
  );
}
