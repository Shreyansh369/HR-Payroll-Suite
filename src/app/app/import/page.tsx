"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { call, useM, useQ, errorMessage } from "@/client/api";
import { useSession } from "@/client/session";
import type { ImportEntity } from "@/domain/types";
import type { ProcOutput } from "@/services/registry";
import { IMPORT_DEFINITIONS, autoMap, templateRows, type DateOrder } from "@/domain/imports/definitions";
import { PageHeader, Panel, PanelHeader, EmptyState, Callout } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Select, Segmented, Checkbox } from "@/components/ui/form";
import { DataTable } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icon";
import { parseImportFile, type ParsedFile } from "@/lib/import/parse-file";
import { rowsToCsv } from "@/lib/export/table-export";
import { saveBlob, slug } from "@/lib/download";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/cn";

type Validation = ProcOutput<"imports.validate">;
type Commit = ProcOutput<"imports.commit">;
const STEPS = ["Upload", "Match columns", "Validate", "Import", "Summary"];

const ENTITY_PERMS: Record<ImportEntity, string> = {
  employees: "employee.create",
  departments: "employee.edit",
  leave_balances: "leave.adjust",
  attendance: "attendance.edit",
  pay_components: "salary.edit",
  deductions: "salary.edit",
  loans: "salary.edit",
  historical_payroll: "payroll.create",
};

async function downloadTemplate(entity: ImportEntity, format: "csv" | "xlsx") {
  const def = IMPORT_DEFINITIONS[entity];
  const { headers, example } = templateRows(def);
  const name = `${slug(def.title)}-template`;
  if (format === "csv") saveBlob(rowsToCsv(headers, [example]), `${name}.csv`, "text/csv;charset=utf-8");
  else {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(def.title.slice(0, 31));
    const h = ws.addRow(headers);
    h.font = { bold: true };
    h.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7EFEC" } }));
    ws.addRow(example).font = { color: { argb: "FF80848B" }, italic: true };
    headers.forEach((hd, i) => (ws.getColumn(i + 1).width = Math.max(14, hd.length + 4)));
    const notes = wb.addWorksheet("Instructions");
    notes.addRow([`${def.title} import template`]).font = { bold: true, size: 13 };
    notes.addRow([def.description]);
    notes.addRow(["Delete the grey example row before importing. Dates: YYYY-MM-DD preferred."]);
    notes.addRow([]);
    notes.addRow(["Column", "Required", "Notes"]).font = { bold: true };
    for (const f of def.fields.filter((x) => x.key !== "fullName")) notes.addRow([f.label, f.required ? "Yes" : "", f.help ?? (f.options ? `One of: ${Object.keys(f.options).map((k) => k.replace(/_/g, "-")).join(", ")}` : "")]);
    notes.getColumn(1).width = 28;
    notes.getColumn(3).width = 80;
    saveBlob(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer), `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
  await call("audit.logExport", { kind: "import_template", title: `${def.title} import template`, format });
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2 text-[12.5px]" aria-label="Import progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span aria-current={i === step ? "step" : undefined} className={cn("flex h-6 w-6 items-center justify-center rounded-full border text-[11.5px] font-semibold num", i < step && "border-accent bg-accent text-white", i === step && "border-accent text-accent", i > step && "border-line text-ink-4")}>
            {i < step ? <Icon name="check" size="sm" /> : i + 1}
          </span>
          <span className={cn(i === step ? "font-medium text-ink" : "text-ink-3")}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line" />}
        </li>
      ))}
    </ol>
  );
}

function ImportWizard() {
  const toast = useToast();
  const { can } = useSession();
  const params = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const available = (Object.keys(IMPORT_DEFINITIONS) as ImportEntity[]).filter((e) => can(ENTITY_PERMS[e] as never));
  const [entity, setEntity] = useState<ImportEntity>((params.get("entity") as ImportEntity) && available.includes(params.get("entity") as ImportEntity) ? (params.get("entity") as ImportEntity) : available[0] ?? "employees");
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>("YMD");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [validating, setValidating] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [result, setResult] = useState<Commit | null>(null);
  const history = useQ("imports.list", {});
  const def = IMPORT_DEFINITIONS[entity];
  const commit = useM("imports.commit", { onSuccess: (r) => { setResult(r); setStep(4); toast.success(`Imported ${r.batch.totals.imported} ${def.title.toLowerCase()}`); }, onError: (e) => toast.error("Import failed", e.message) });

  const mappedFields = new Set(Object.values(mapping).filter(Boolean));
  const missingRequired = def.fields.filter((f) => f.required && !mappedFields.has(f.key) && !(entity === "employees" && (f.key === "firstName" || f.key === "lastName") && mappedFields.has("fullName")));
  const needsDateOrder = useMemo(() => {
    if (!file) return false;
    const dateCols = Object.entries(mapping).filter(([, k]) => def.fields.find((f) => f.key === k)?.kind === "date").map(([c]) => c);
    return file.rows.slice(0, 200).some((r) => dateCols.some((c) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(r[c] ?? "")));
  }, [file, mapping, def]);

  async function onFile(f: File | null) {
    if (!f) return;
    setParsing(true);
    setParseError(null);
    try {
      const parsed = await parseImportFile(f);
      if (parsed.rows.length === 0) throw new Error("No data rows were found under the header row.");
      setFile(parsed);
      setMapping(autoMap(parsed.headers, def));
      setValidation(null);
      setStep(1);
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function validate() {
    if (!file) return;
    setValidating(true);
    try {
      const v = await call("imports.validate", { entity, fileName: file.fileName, rows: file.rows, mapping, dateOrder });
      setValidation(v);
      setStep(2);
    } catch (e) {
      toast.error("Validation failed", errorMessage(e));
    } finally {
      setValidating(false);
    }
  }

  function downloadRejected(rows: { row: number; status: string; errors: { field?: string; message: string }[]; source: Record<string, string> }[]) {
    if (!file || rows.length === 0) return;
    const headers = ["Row", "Problem", ...file.headers];
    saveBlob(rowsToCsv(headers, rows.map((r) => [r.row, r.errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join("; "), ...file.headers.map((h) => r.source[h] ?? "")])), `rejected-${slug(file.fileName)}.csv`, "text/csv;charset=utf-8");
    void call("audit.logExport", { kind: "rejected_rows", title: `Rejected rows from ${file.fileName}`, format: "csv", rows: rows.length });
  }

  function reset() {
    setStep(0);
    setFile(null);
    setValidation(null);
    setResult(null);
    setMapping({});
    if (fileRef.current) fileRef.current.value = "";
  }

  const problemRows = validation?.rows.filter((r) => r.status !== "valid") ?? [];

  return (
    <>
      <PageHeader title="Import data" description="Bring employees, balances and history over from spreadsheets. Nothing is written until you confirm the import, and invalid rows are never imported." />
      <Stepper step={step} />

      {step === 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel>
            <PanelHeader title="What are you importing?" />
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {available.map((e) => (
                <button key={e} type="button" onClick={() => setEntity(e)} className={cn("rounded-lg border p-3 text-left transition-colors", entity === e ? "border-accent bg-accent-soft/50 ring-1 ring-accent" : "border-line hover:border-line-strong")}>
                  <p className="text-[13px] font-semibold">{IMPORT_DEFINITIONS[e].title}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">{IMPORT_DEFINITIONS[e].description}</p>
                </button>
              ))}
            </div>
            <div className="border-t border-line p-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files[0] ?? null); }}
                className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-2 px-6 py-10 text-center"
              >
                <Icon name="upload" size="lg" className="text-ink-3" />
                <p className="mt-2 text-[13.5px] font-medium">Drop a spreadsheet for {def.title.toLowerCase()}</p>
                <p className="mt-0.5 text-[12px] text-ink-3">CSV, TSV or Excel (.xlsx) · up to 5,000 rows</p>
                <Button variant="primary" className="mt-3" loading={parsing} onClick={() => fileRef.current?.click()}>Choose file</Button>
                <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
              </div>
              {parseError && <Callout tone="danger" className="mt-3">{parseError}</Callout>}
            </div>
          </Panel>
          <div className="space-y-4">
            <Panel>
              <PanelHeader title="Template" description="Start from our layout, or upload your own — columns are matched automatically." />
              <div className="flex gap-2 p-4">
                <Button icon="download" onClick={() => downloadTemplate(entity, "xlsx")}>Excel template</Button>
                <Button icon="download" variant="ghost" onClick={() => downloadTemplate(entity, "csv")}>CSV</Button>
              </div>
              <ul className="space-y-1 border-t border-line px-4 py-3 text-[12px]">
                {def.fields.filter((f) => f.key !== "fullName").map((f) => (
                  <li key={f.key} className="flex justify-between gap-2"><span className="text-ink-2">{f.label}</span>{f.required && <Badge tone="accent">Required</Badge>}</li>
                ))}
              </ul>
            </Panel>
            <Panel>
              <PanelHeader title="Recent imports" />
              {history.data?.length ? (
                <ul className="divide-y divide-line">
                  {history.data.slice(0, 6).map((b) => (
                    <li key={b.id} className="px-4 py-2 text-[12.5px]">
                      <p className="flex items-center justify-between gap-2"><span className="truncate font-medium">{b.fileName}</span><StatusBadge status={b.status} /></p>
                      <p className="text-[11.5px] text-ink-3">{IMPORT_DEFINITIONS[b.entity].title} · {b.totals.imported} imported · {b.totals.rejected + b.totals.duplicates} rejected · {b.createdByName} · {b.createdAtLabel}</p>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact icon="import" title="No imports yet" />}
            </Panel>
          </div>
        </div>
      )}

      {step === 1 && file && (
        <Panel>
          <PanelHeader
            title={`Match columns · ${file.fileName}`}
            description={`${file.rows.length} data rows${file.sheetName ? ` from sheet “${file.sheetName}”` : ""}${file.truncated ? " (first 5,000 rows only)" : ""}. We matched ${Object.values(mapping).filter(Boolean).length} of ${file.headers.length} columns.`}
            actions={<><Button variant="ghost" onClick={reset}>Start over</Button><Button variant="primary" disabled={missingRequired.length > 0} loading={validating} onClick={validate}>Validate {file.rows.length} rows</Button></>}
          />
          {missingRequired.length > 0 && <Callout tone="warning" className="m-4">Match a column to: {missingRequired.map((f) => f.label).join(", ")}.</Callout>}
          {needsDateOrder && (
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 text-[12.5px]">
              <span className="font-medium">Dates like 04/05/2026 mean:</span>
              <Segmented size="sm" label="Date order" value={dateOrder} onChange={setDateOrder} options={[{ value: "DMY", label: "4 May (day first)" }, { value: "MDY", label: "April 5 (month first)" }, { value: "YMD", label: "ISO only" }]} />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-ink-3">
                <tr><th className="px-4 py-2 text-left font-medium">Your column</th><th className="px-4 py-2 text-left font-medium">Sample values</th><th className="w-[280px] px-4 py-2 text-left font-medium">Import as</th></tr>
              </thead>
              <tbody>
                {file.headers.map((h) => {
                  const used = new Set(Object.entries(mapping).filter(([c, k]) => c !== h && k).map(([, k]) => k));
                  return (
                    <tr key={h} className="border-t border-line">
                      <td className="px-4 py-2 font-medium">{h}</td>
                      <td className="max-w-[320px] truncate px-4 py-2 text-ink-3">{file.rows.slice(0, 3).map((r) => r[h]).filter(Boolean).join(" · ") || <span className="text-ink-4">empty</span>}</td>
                      <td className="px-4 py-1.5">
                        <Select value={mapping[h] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))} aria-label={`Import ${h} as`} className={cn(mapping[h] && "border-accent-line bg-accent-soft/40")}>
                          <option value="">Don&apos;t import</option>
                          {def.fields.filter((f) => !used.has(f.key)).map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>)}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {step === 2 && validation && file && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
            {[["Rows in file", validation.summary.rows, "neutral"], ["Ready to import", validation.summary.valid, "success"], ["Need attention", validation.summary.errors, "warning"], ["Duplicates", validation.summary.duplicates, "danger"]].map(([k, v, tone]) => (
              <div key={k as string} className="bg-surface px-4 py-3">
                <p className="text-[12px] text-ink-3">{k}</p>
                <p className={cn("mt-0.5 text-[22px] font-semibold num", tone === "success" && "text-success", tone === "warning" && (v as number) > 0 && "text-warning", tone === "danger" && (v as number) > 0 && "text-danger")}>{v as number}</p>
              </div>
            ))}
          </div>
          <Panel>
            <PanelHeader
              title="Dry run"
              description={validation.summary.valid ? `${validation.summary.valid} rows will be imported. Rows with problems are skipped — fix them in your file and import them later.` : "No rows can be imported yet."}
              actions={
                <>
                  <Checkbox label="Only rows with problems" checked={onlyProblems} onChange={setOnlyProblems} />
                  {problemRows.length > 0 && <Button size="sm" icon="download" onClick={() => downloadRejected(problemRows)}>Download {problemRows.length} rows to fix</Button>}
                </>
              }
            />
            <DataTable
              dense
              maxHeight="max-h-[520px]"
              columns={[
                { key: "row", header: "Row", cell: (r) => <span className="num text-ink-3">{r.row}</span> },
                { key: "status", header: "Status", cell: (r) => (r.status === "valid" ? <Badge tone="success">Ready</Badge> : r.status === "duplicate" ? <Badge tone="danger">Duplicate</Badge> : <Badge tone="warning">Error</Badge>) },
                ...def.fields.filter((f) => mappedFields.has(f.key) || (f.key === "firstName" && mappedFields.has("fullName")) || (f.key === "lastName" && mappedFields.has("fullName"))).filter((f) => f.key !== "fullName").slice(0, 6).map((f) => ({ key: f.key, header: f.label, hideBelow: f.required ? undefined : ("lg" as const), cell: (r: Validation["rows"][number]) => <span className="block max-w-[180px] truncate">{r.values[f.key] === null || r.values[f.key] === undefined ? "" : String(r.values[f.key])}</span> })),
                { key: "errors", header: "Problems", cell: (r) => r.errors.length ? <ul className="text-[12px] text-danger">{r.errors.map((e, i) => <li key={i}>{e.field ? <span className="font-medium">{e.field}: </span> : null}{e.message}</li>)}</ul> : <span className="text-ink-4">—</span> },
              ]}
              rows={onlyProblems ? problemRows : validation.rows}
              rowKey={(r) => String(r.row)}
              empty={<EmptyState compact icon="success" title="Every row is valid" />}
            />
          </Panel>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>Back to column matching</Button>
            <Button variant="primary" disabled={validation.summary.valid === 0} onClick={() => setStep(3)}>Continue with {validation.summary.valid} valid rows</Button>
          </div>
        </div>
      )}

      {step === 3 && validation && file && (
        <Panel padded className="mx-auto max-w-xl p-6 text-center">
          <Icon name="import" size="lg" className="mx-auto text-accent" />
          <h2 className="mt-3 text-[17px] font-semibold">Import {validation.summary.valid} {def.title.toLowerCase()}?</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            From <span className="font-medium">{file.fileName}</span>. {validation.summary.errors + validation.summary.duplicates > 0 ? `${validation.summary.errors + validation.summary.duplicates} rows with problems will be skipped.` : "All rows are valid."} The import is recorded as a batch in the audit log.
          </p>
          {entity === "historical_payroll" && <Callout tone="neutral" className="mt-3 text-left">Historical payroll is imported as locked runs so year-to-date totals include pre-system pay.</Callout>}
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
            <Button variant="primary" size="lg" loading={commit.isPending} onClick={() => commit.mutate({ entity, fileName: file.fileName, rows: file.rows, mapping, dateOrder })}>Import {validation.summary.valid} rows</Button>
          </div>
        </Panel>
      )}

      {step === 4 && result && (
        <Panel padded className="mx-auto max-w-2xl p-6">
          <div className="text-center">
            <Icon name="success" size="lg" className="mx-auto text-success" />
            <h2 className="mt-3 text-[17px] font-semibold">Import complete</h2>
            <p className="mt-1 text-[13px] text-ink-2">Batch {result.batch.id} · {result.batch.fileName}</p>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
            {[["Imported", result.batch.totals.imported, "text-success"], ["Rejected", result.batch.totals.rejected, result.batch.totals.rejected ? "text-warning" : ""], ["Duplicates", result.batch.totals.duplicates, result.batch.totals.duplicates ? "text-danger" : ""]].map(([k, v, c]) => (
              <div key={k as string} className="bg-surface py-3"><p className="text-[12px] text-ink-3">{k}</p><p className={cn("text-[22px] font-semibold num", c as string)}>{v as number}</p></div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {result.rejected.length > 0 && <Button icon="download" onClick={() => downloadRejected(result.rejected)}>Download rejected rows</Button>}
            {entity === "employees" && <Link href="/app/employees" className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">View employees</Link>}
            <Button variant="primary" onClick={reset}>Import another file</Button>
          </div>
          <p className="mt-4 text-center text-[11.5px] text-ink-3">Imported {formatDate(result.batch.createdAt.slice(0, 10))} by {result.batch.createdByName}.</p>
        </Panel>
      )}
    </>
  );
}

export default function ImportPage() {
  return (
    <Suspense>
      <ImportWizard />
    </Suspense>
  );
}
