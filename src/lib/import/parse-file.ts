"use client";

/** Parse CSV, TSV or XLSX files into header + string rows. Runs in the browser. */
export interface ParsedFile {
  fileName: string;
  format: "csv" | "tsv" | "xlsx";
  sheetName?: string;
  headers: string[];
  rows: Record<string, string>[];
  truncated: boolean;
}

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    const base = (h ?? "").toString().trim() || `Column ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // Excel dates are stored as UTC midnight.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.result !== undefined) return cellToString(o.result);
    if (o.text !== undefined) return String(o.text);
    return "";
  }
  return String(v).trim();
}

export async function parseImportFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("Files must be 10 MB or smaller.");
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xlsx" || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
    if (!ws) throw new Error("The workbook has no sheets.");
    const all: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[];
      all.push(values.slice(1).map(cellToString));
    });
    // Header row = first row with at least two non-empty cells.
    const headerIndex = Math.max(0, all.findIndex((r) => r.filter(Boolean).length >= 2));
    const headers = dedupeHeaders(all[headerIndex] ?? []);
    const body = all.slice(headerIndex + 1).filter((r) => r.some((c) => c !== ""));
    return {
      fileName: file.name,
      format: "xlsx",
      sheetName: ws.name,
      headers,
      rows: body.slice(0, MAX_IMPORT_ROWS).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))),
      truncated: body.length > MAX_IMPORT_ROWS,
    };
  }
  if (["csv", "tsv", "txt"].includes(ext) || file.type.startsWith("text/")) {
    const Papa = (await import("papaparse")).default;
    const text = await file.text();
    const delimiter = ext === "tsv" || (ext === "txt" && text.split("\n")[0].includes("\t")) ? "\t" : "";
    const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { delimiter, skipEmptyLines: "greedy" });
    if (res.errors.length && res.data.length === 0) throw new Error(`Could not read the file: ${res.errors[0].message}`);
    const headers = dedupeHeaders(res.data[0] ?? []);
    const body = res.data.slice(1);
    return {
      fileName: file.name,
      format: delimiter === "\t" ? "tsv" : "csv",
      headers,
      rows: body.slice(0, MAX_IMPORT_ROWS).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))),
      truncated: body.length > MAX_IMPORT_ROWS,
    };
  }
  throw new Error("Upload a CSV, TSV or XLSX file.");
}
