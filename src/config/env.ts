/**
 * Public runtime configuration. Values are inlined at build time by next.config.ts,
 * which maps the server-side DEMO_MODE / BILLING_ENABLED variables.
 */
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
export const BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "HR & Payroll Suite";
export const APP_SHORT = process.env.NEXT_PUBLIC_APP_SHORT || "HPS";
export const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL || "sales@example.com";
