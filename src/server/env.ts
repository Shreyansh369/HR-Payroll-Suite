/**
 * Server-side configuration, validated once. Production refuses to start
 * request handling with missing or weak security settings.
 */
import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const schema = z.object({
  DEMO_MODE: bool(true),
  APP_URL: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  DATA_ENCRYPTION_KEY: z.string().optional(),
  SETUP_TOKEN: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(24 * 30).default(12),
  STORAGE_DRIVER: z.enum(["database", "local"]).default("database"),
  STORAGE_DIR: z.string().default("./storage"),
  BILLING_ENABLED: bool(false),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_HOSTED_SETUP: z.string().optional(),
  STRIPE_PRICE_HOSTED_MONTHLY: z.string().optional(),
  STRIPE_PRICE_OWNED: z.string().optional(),
  TRUST_PROXY: bool(true),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** Throws a clear error when production is not configured. Never leaks values. */
export function assertProductionReady(): ServerEnv & { DATABASE_URL: string; DATA_ENCRYPTION_KEY: string } {
  const env = serverEnv();
  if (env.DEMO_MODE) throw new AppError("NOT_FOUND", "This deployment runs in demo mode; the server API is disabled.");
  const missing = [!env.DATABASE_URL && "DATABASE_URL", !env.DATA_ENCRYPTION_KEY && "DATA_ENCRYPTION_KEY"].filter(Boolean);
  if (missing.length) throw new AppError("INTERNAL", `Server is not configured: set ${missing.join(", ")}.`);
  return env as ServerEnv & { DATABASE_URL: string; DATA_ENCRYPTION_KEY: string };
}

export function billingConfigured(env = serverEnv()): boolean {
  return !env.DEMO_MODE && env.BILLING_ENABLED && !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET;
}
