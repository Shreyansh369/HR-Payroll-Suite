import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DEMO, confirmDialog, login, watchErrors } from "./helpers";

/** Creates the next Harbourview monthly payroll (October 2026) and calculates it. */
async function newCalculatedRun(page: Page) {
  await page.goto("/app/payroll");
  await page.getByRole("button", { name: "New payroll run" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Create payroll" }).click();
  await page.waitForURL(/\/app\/payroll\/run_/);
  await page.getByRole("button", { name: "Calculate" }).first().click();
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeVisible({ timeout: 30_000 });
}

async function toReview(page: Page) {
  await page.getByRole("button", { name: "Submit for review" }).click();
  const ack = page.getByRole("button", { name: "Acknowledge all warnings" });
  if (await ack.isVisible().catch(() => false)) await ack.click();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled({ timeout: 30_000 });
}

test("7. approved unpaid leave becomes a payroll deduction", async ({ page }) => {
  await login(page, DEMO.admin);
  await page.goto("/app/leave");
  await page.getByRole("button", { name: "Record leave" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Employee/).selectOption({ label: "Shanice Penn (HHL-006)" });
  await dialog.getByLabel(/^Leave type/).selectOption({ label: "Unpaid leave (unpaid)" });
  await dialog.getByLabel(/^From/).fill("2026-10-14");
  await dialog.getByLabel(/^To/).fill("2026-10-14");
  await dialog.getByRole("button", { name: "Record and approve" }).click();
  await expect(dialog).toBeHidden();
  await newCalculatedRun(page);
  await page.getByText("Shanice Penn").first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText(/Unpaid leave/i).first()).toBeVisible();
  await expect(drawer.getByText(/1 day/).first()).toBeVisible();
});

test("8. calculates a payroll with totals and pre-flight checks", async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, DEMO.payroll);
  await newCalculatedRun(page);
  await expect(page.getByText("Gross pay").first()).toBeVisible();
  await expect(page.getByText("Pre-flight checks")).toBeVisible();
  await page.getByText("Shanice Penn").first().click();
  await expect(page.getByRole("dialog").getByText(/×|÷/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("9. moves a payroll to review and clears warnings", async ({ page }) => {
  await login(page, DEMO.payroll);
  await newCalculatedRun(page);
  await toReview(page);
  await expect(page.getByText("In review").first()).toBeVisible();
});

test("10. approves a payroll with a recorded note", async ({ page }) => {
  await login(page, DEMO.admin);
  await newCalculatedRun(page);
  await toReview(page);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await confirmDialog(page, "Approve", "Checked against timesheets (E2E).");
  await expect(page.getByRole("button", { name: "Finalize" })).toBeVisible();
});

test("11. finalizes and locks a payroll", async ({ page }) => {
  await login(page, DEMO.admin);
  await newCalculatedRun(page);
  await toReview(page);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await confirmDialog(page, "Approve", "E2E approval");
  await page.getByRole("button", { name: "Finalize" }).click();
  await confirmDialog(page, "Finalize");
  await page.getByRole("button", { name: "Lock payroll" }).click();
  await confirmDialog(page, "Lock payroll");
  await expect(page.getByText(/^Locked$/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Calculate" })).toHaveCount(0);
});

test("12. generates payslips for a run and for an employee", async ({ page }) => {
  await login(page, DEMO.payroll);
  await page.goto("/app/payroll");
  await page.getByText("Monthly payroll · September 2026", { exact: true }).first().click();
  await page.waitForURL(/\/app\/payroll\/run_/);
  await page.getByRole("button", { name: "Payslips" }).click();
  const [zip] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /ZIP/ }).click()]);
  expect(zip.suggestedFilename()).toMatch(/\.zip$/);
  const bytes = await readFile((await zip.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");

  await page.context().clearCookies();
  await login(page, DEMO.employee);
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PDF" }).first().click()]);
  const pdfBytes = await readFile((await pdf.path())!);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
});

test("13. exports a report to CSV, Excel and PDF", async ({ page }) => {
  await login(page, DEMO.accountant);
  await page.goto("/app/reports/payroll_register");
  await expect(page.getByRole("table").first()).toBeVisible();
  for (const [fmt, check] of [
    [/CSV/, (b: Buffer) => expect(b.toString("utf8")).toContain("Employee")],
    [/XLSX|Excel/, (b: Buffer) => expect(b.subarray(0, 2).toString()).toBe("PK")],
    [/PDF/, (b: Buffer) => expect(b.subarray(0, 5).toString()).toBe("%PDF-")],
  ] as const) {
    await page.getByRole("button", { name: "Export" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: fmt }).click()]);
    check(await readFile((await dl.path())!));
  }
});
