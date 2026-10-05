import { expect, type Page } from "@playwright/test";

export const DEMO = {
  admin: "demo.admin@example.com",
  hr: "demo.hr@example.com",
  payroll: "demo.payroll@example.com",
  supervisor: "demo.supervisor@example.com",
  employee: "demo.employee@example.com",
  accountant: "demo.accountant@example.com",
};

/** Signs in to the browser-only demo. The first sign-in in a fresh context seeds the fictional data. */
export async function login(page: Page, email = DEMO.admin, password = "demo-payroll-2026") {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 90_000 });
}

export async function switchCompany(page: Page, name: RegExp) {
  await page.getByRole("button", { name: /Switch company/ }).click();
  await page.getByRole("menuitem", { name }).click();
  await expect(page.getByRole("button", { name: /Switch company/ })).toHaveAccessibleName(name);
}

/** Confirms a ConfirmDialog, filling the reason when the dialog asks for one. */
export async function confirmDialog(page: Page, confirmLabel: string, reason?: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (reason) await dialog.locator("textarea").fill(reason);
  await dialog.getByRole("button", { name: confirmLabel, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** Collects page errors so each test can assert a clean console. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/hydrat|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}
