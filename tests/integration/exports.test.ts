import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { as, seededRepo } from "./helpers";
import { renderPayslipZip, renderPayslips } from "@/lib/pdf/payslip";

describe("payslip rendering", () => {
  it("renders a PDF per employee and a ZIP bundle from authorized data", async () => {
    const { repo, storage } = await seededRepo();
    const payroll = await as(repo, storage, "demo.payroll@example.com");
    const [run] = await payroll.call("payroll.runs.list", { status: ["finalized"] });
    const bundle = await payroll.call("payroll.payslips", { runId: run.id });
    expect(bundle.payslips.length).toBe(run.totals!.employees);
    const pdf = await renderPayslips(bundle, { demo: true });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const zip = await renderPayslipZip({ ...bundle, payslips: bundle.payslips.slice(0, 3) }, { demo: false });
    const files = unzipSync(zip);
    expect(Object.keys(files)).toHaveLength(3);
    for (const f of Object.values(files)) expect(new TextDecoder().decode(f.slice(0, 5))).toBe("%PDF-");
  });

  it("includes year-to-date figures on payslips", async () => {
    const { repo, storage } = await seededRepo();
    const emp = await as(repo, storage, "demo.employee@example.com");
    const [latest] = await emp.call("me.payslips", {});
    const bundle = await emp.call("me.payslip", { resultId: latest.id });
    expect(bundle.payslips[0].ytd.payments).toBeGreaterThan(1);
    expect(bundle.payslips[0].ytd.gross).toBeGreaterThan(bundle.payslips[0].result.totals.gross);
  });
});
