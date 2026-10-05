import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DEMO, login, switchCompany, watchErrors } from "./helpers";

test("1. admin signs in to the demo", async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, DEMO.admin);
  await expect(page.getByText("DEMO DATA").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Company: Harbourview Hospitality/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Payroll runs" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("2. switches company and sees only that company's employees", async ({ page }) => {
  await login(page, DEMO.admin);
  await switchCompany(page, /Tortola Marine/);
  await page.goto("/app/employees");
  await expect(page.getByText(/TMS-0\d\d/).first()).toBeVisible();
  await expect(page.getByText(/HHL-0\d\d/)).toHaveCount(0);
});

test("3. creates an employee", async ({ page }) => {
  await login(page, DEMO.hr);
  await page.goto("/app/employees/new");
  await page.getByLabel(/^Employee ID/).fill("E2E-001");
  await page.getByLabel(/^First name/).fill("Robin");
  await page.getByLabel(/^Last name/).fill("Testwell");
  await page.getByLabel(/^Date of birth/).fill("1991-03-14");
  await page.getByLabel(/^Position/).fill("Front Desk Agent");
  await page.getByLabel(/^Hire date/).fill("2026-10-12");
  await page.getByRole("button", { name: "Save employee" }).click();
  await page.waitForURL(/\/app\/employees\/emp_/);
  await expect(page.getByRole("heading", { name: /Robin Testwell/ })).toBeVisible();
  await page.goto("/app/employees");
  await expect(page.getByText("E2E-001")).toBeVisible();
});

test("4. imports employees from a spreadsheet with row-level errors", async ({ page }) => {
  await login(page, DEMO.admin);
  await page.goto("/app/import");
  await page.setInputFiles('input[type="file"]', "public/samples/new-hires-sample.csv");
  await page.getByRole("radio", { name: /day first/ }).click();
  await page.getByRole("button", { name: /^Validate/ }).click();
  await expect(page.getByText(/already exists/).first()).toBeVisible();
  await page.getByRole("button", { name: /^Continue with/ }).click();
  await page.getByRole("button", { name: /^Import \d+ rows/ }).click();
  await expect(page.getByText(/imported/i).first()).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download rejected rows" }).click()]);
  const rejected = await readFile((await download.path())!, "utf8");
  expect(rejected).toContain("HHL-001");
});

test("5. employee requests leave from self-service", async ({ page }) => {
  await login(page, DEMO.employee);
  await page.waitForURL(/\/app\/me/);
  await page.getByRole("button", { name: "Request leave" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Leave type/).selectOption({ label: "Vacation" });
  await dialog.getByLabel(/^From/).fill("2026-11-16");
  await dialog.getByLabel(/^To/).fill("2026-11-17");
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("tab", { name: "Leave" }).click();
  await expect(page.getByText(/Pending/).first()).toBeVisible();
});

test("6. supervisor approves team leave", async ({ page }) => {
  await login(page, DEMO.supervisor);
  await page.goto("/app/leave");
  const approve = page.getByRole("button", { name: "Approve", exact: true }).first();
  await expect(approve).toBeVisible();
  const before = await page.getByRole("button", { name: "Approve", exact: true }).count();
  await approve.click();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(before - 1);
});

test("14. supervisor never sees salary information", async ({ page }) => {
  await login(page, DEMO.supervisor);
  await expect(page.getByRole("link", { name: "Payroll runs" })).toHaveCount(0);
  await page.goto("/app/employees");
  await page.getByText("HHL-006").click();
  await page.waitForURL(/\/app\/employees\/emp_/);
  await expect(page.getByRole("tab", { name: "Compensation" })).toHaveCount(0);
  await expect(page.getByText(/\$\d{1,3}(,\d{3})*\.\d{2}/)).toHaveCount(0);
  await page.goto("/app/payroll");
  await expect(page.getByText(/permission/i).first()).toBeVisible();
});

test("15. employee can only reach their own records", async ({ page }) => {
  await login(page, DEMO.employee);
  await expect(page.getByRole("link", { name: "Employees" })).toHaveCount(0);
  await page.goto("/app/employees");
  await expect(page.getByText(/permission/i).first()).toBeVisible();
  await page.goto("/app/reports/payroll_register");
  await expect(page.getByText(/permission/i).first()).toBeVisible();
});

test("16. demo reset restores the original data", async ({ page }) => {
  await login(page, DEMO.hr);
  await page.goto("/app/employees/new");
  await page.getByLabel(/^Employee ID/).fill("RESET-1");
  await page.getByLabel(/^First name/).fill("Temporary");
  await page.getByLabel(/^Last name/).fill("Record");
  await page.getByLabel(/^Date of birth/).fill("1990-01-01");
  await page.getByLabel(/^Position/).fill("Temp");
  await page.getByLabel(/^Hire date/).fill("2026-10-12");
  await page.getByRole("button", { name: "Save employee" }).click();
  await page.waitForURL(/\/app\/employees\/emp_/);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Reset demo data" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset demo" }).click();
  await page.waitForURL(/\/app$/, { timeout: 90_000 });
  await page.goto("/app/employees");
  await expect(page.getByText("HHL-001")).toBeVisible();
  await expect(page.getByText("RESET-1")).toHaveCount(0);
});
