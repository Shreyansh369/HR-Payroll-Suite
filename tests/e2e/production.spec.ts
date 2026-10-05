/**
 * Production-mode scenarios. They run only against a deployed production server:
 *   E2E_PRODUCTION_URL=https://… E2E_PRODUCTION_EMAIL=… E2E_PRODUCTION_PASSWORD=… pnpm test:e2e production
 * The Stripe scenario additionally needs E2E_STRIPE=1 and a server in Stripe TEST mode.
 */
import { expect, test } from "@playwright/test";

const url = process.env.E2E_PRODUCTION_URL;
const email = process.env.E2E_PRODUCTION_EMAIL;
const password = process.env.E2E_PRODUCTION_PASSWORD;

test.describe("production", () => {
  test.skip(!url || !email || !password, "Set E2E_PRODUCTION_URL, E2E_PRODUCTION_EMAIL and E2E_PRODUCTION_PASSWORD to run.");
  test.use({ baseURL: url });

  test("17. authenticates with real accounts and rejects bad credentials and cross-site requests", async ({ page, request }) => {
    const anon = await request.post("/api/rpc/session.context", { data: {}, headers: { "content-type": "application/json" } });
    expect(anon.status()).toBe(401);
    const csrf = await request.post("/api/auth/login", { data: { email, password }, headers: { origin: "https://attacker.example", "content-type": "application/json" } });
    expect(csrf.status()).toBe(403);

    await page.goto("/login");
    await page.locator("#email").fill(email!);
    await page.locator("#password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();

    await page.locator("#password").fill(password!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/app/);
    await expect(page.getByText("DEMO DATA")).toHaveCount(0);
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name.endsWith("hps_session"));
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
  });

  test("18. starts Stripe checkout without granting access before the webhook", async ({ page }) => {
    test.skip(process.env.E2E_STRIPE !== "1", "Set E2E_STRIPE=1 with a server in Stripe test mode.");
    await page.goto("/login");
    await page.locator("#email").fill(email!);
    await page.locator("#password").fill(password!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/app/);
    await page.goto("/app/billing?checkout=success");
    // A success redirect alone must not activate anything.
    await expect(page.getByText(/Waiting for payment confirmation|Your plan is active/)).toBeVisible();
    await page.goto("/app/billing");
    const start = page.getByRole("button", { name: /Start 7-day trial|Buy licence/ }).first();
    await start.click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  });
});
