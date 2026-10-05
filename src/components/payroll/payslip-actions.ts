"use client";

import { call } from "@/client/api";
import { IS_DEMO } from "@/config/env";
import { saveBlob, slug } from "@/lib/download";

export async function downloadPayslip(runId: string, employeeId: string) {
  const bundle = await call("payroll.payslips", { runId, employeeIds: [employeeId] });
  const { renderPayslips } = await import("@/lib/pdf/payslip");
  const bytes = await renderPayslips(bundle, { demo: IS_DEMO });
  const r = bundle.payslips[0]?.result;
  await call("audit.logExport", { kind: "payslip", title: `Payslip ${r?.employee.name ?? ""} · ${bundle.run.name}`, format: "pdf", rows: 1, entityId: runId });
  saveBlob(bytes, `payslip-${slug(r?.employee.name ?? "employee")}-${bundle.run.payDate}.pdf`, "application/pdf");
}

export async function downloadOwnPayslip(resultId: string) {
  const bundle = await call("me.payslip", { resultId });
  const { renderPayslips } = await import("@/lib/pdf/payslip");
  const bytes = await renderPayslips(bundle, { demo: IS_DEMO });
  saveBlob(bytes, `payslip-${bundle.run.payDate}.pdf`, "application/pdf");
}

export async function downloadAllPayslips(runId: string, format: "pdf" | "zip") {
  const bundle = await call("payroll.payslips", { runId });
  const mod = await import("@/lib/pdf/payslip");
  const bytes = format === "zip" ? await mod.renderPayslipZip(bundle, { demo: IS_DEMO }) : await mod.renderPayslips(bundle, { demo: IS_DEMO });
  await call("audit.logExport", { kind: "payslips_bulk", title: `Payslips · ${bundle.run.name}`, format, rows: bundle.payslips.length, entityId: runId });
  saveBlob(bytes, `payslips-${slug(bundle.run.name)}.${format}`, format === "zip" ? "application/zip" : "application/pdf");
  return bundle.payslips.length;
}
