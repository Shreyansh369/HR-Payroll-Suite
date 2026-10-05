import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. By default a production build of the DEMO is started on
 * port 3300. Point E2E_BASE_URL at an already running server to reuse it.
 * Production-mode scenarios run only when E2E_PRODUCTION_URL is set.
 */
const external = process.env.E2E_BASE_URL;
const port = 3300;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: external ?? `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {} } }],
  webServer: external
    ? undefined
    : { command: `pnpm build && pnpm start --port ${port}`, port, timeout: 600_000, reuseExistingServer: !process.env.CI, env: { DEMO_MODE: "true" } },
});
