/**
 * Procedure framework shared by the demo (in-browser) and production (HTTP) transports.
 */
import { z } from "zod";
import type { Permission } from "@/domain/auth/permissions";
import type { AuditEvent, ID, License } from "@/domain/types";
import type { DocumentStorage, Repository } from "@/repositories/interfaces";
import { AppError, forbidden, type FieldIssue } from "@/lib/errors";
import { randomId, type IdGenerator } from "@/lib/ids";
import { todayISO } from "@/lib/dates";
import { assertPermission, type Actor } from "@/services/authz";

export type AppMode = "demo" | "production";

export type Feature = "hr" | "payroll" | "imports" | "reports" | "accounting" | "multi_company";

export interface Entitlements {
  active: boolean;
  plan: License["plan"];
  status: License["status"];
  features: ReadonlySet<Feature>;
  employeeLimit: number | null;
  reason: string | null;
}

export interface Ctx {
  actor: Actor;
  repo: Repository;
  storage: DocumentStorage;
  mode: AppMode;
  entitlements: Entitlements;
  now: () => Date;
  ids: IdGenerator;
  meta?: { ip?: string | null; userAgent?: string | null };
  /** Production only: server-side password hashing for user management. */
  security?: { hashPassword: (password: string) => Promise<string> };
}

export interface ProcedureDef<I extends z.ZodType, O> {
  input: I;
  /** Any-of permission requirement. `null` = any authenticated user (procedure must scope itself). */
  permission: Permission | Permission[] | null;
  feature?: Feature;
  /** Read-only procedures can be cached and are safe to retry. */
  kind?: "query" | "mutation";
  handler: (ctx: Ctx, input: z.infer<I>) => Promise<O>;
}

export interface Procedure<I extends z.ZodType = z.ZodType, O = unknown> extends ProcedureDef<I, O> {
  kind: "query" | "mutation";
}

export function query<I extends z.ZodType, O>(def: ProcedureDef<I, O>): Procedure<I, O> {
  return { ...def, kind: "query" };
}

export function mutation<I extends z.ZodType, O>(def: ProcedureDef<I, O>): Procedure<I, O> {
  return { ...def, kind: "mutation" };
}

export function zodIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export async function execute<I extends z.ZodType, O>(proc: Procedure<I, O>, ctx: Ctx, raw: unknown): Promise<O> {
  const parsed = proc.input.safeParse(raw ?? {});
  if (!parsed.success) {
    const issues = zodIssues(parsed.error);
    throw new AppError("VALIDATION", issues[0] ? `${issues[0].path ? `${issues[0].path}: ` : ""}${issues[0].message}` : "Invalid input.", issues);
  }
  if (proc.permission !== null) assertPermission(ctx.actor, proc.permission);
  if (proc.feature && !ctx.entitlements.features.has(proc.feature)) {
    throw new AppError("ENTITLEMENT", ctx.entitlements.reason ?? "Your plan does not include this feature.");
  }
  if (proc.kind === "mutation" && !ctx.entitlements.active && proc.feature) {
    throw new AppError("ENTITLEMENT", ctx.entitlements.reason ?? "Your subscription is not active.");
  }
  return proc.handler(ctx, parsed.data as z.infer<I>);
}

export function nowISO(ctx: Pick<Ctx, "now">): string {
  return ctx.now().toISOString();
}

export async function companyToday(ctx: Ctx): Promise<string> {
  const company = await ctx.repo.companies.get(ctx.actor.companyId);
  return todayISO(company?.timezone ?? "UTC", ctx.now());
}

export async function audit(
  ctx: Ctx,
  event: Pick<AuditEvent, "action" | "entityType" | "summary"> &
    Partial<Pick<AuditEvent, "entityId" | "before" | "after" | "reason" | "companyId">>,
): Promise<void> {
  await ctx.repo.audit.append({
    id: ctx.ids("aud"),
    organizationId: ctx.actor.organizationId,
    companyId: event.companyId === undefined ? ctx.actor.companyId : event.companyId,
    at: nowISO(ctx),
    actorId: ctx.actor.userId,
    actorName: ctx.actor.name,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    summary: event.summary,
    before: event.before,
    after: event.after,
    reason: event.reason ?? null,
    meta: ctx.meta ?? null,
  });
}

/** Minimal before/after diff for audit records. */
export function diff<T extends object>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

export const defaultIds: IdGenerator = (prefix) => randomId(prefix);

export function requireMode(ctx: Ctx, mode: AppMode) {
  if (ctx.mode !== mode) throw forbidden(`This action is only available in ${mode} mode.`);
}

export const idSchema = z.string().min(1).max(64);
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Invalid date");
export const money = z.number().finite().min(0).max(100_000_000);
export const signedMoney = z.number().finite().min(-100_000_000).max(100_000_000);
export const nonEmpty = (max = 200) => z.string().trim().min(1, "Required").max(max);
export const optionalText = (max = 2000) => z.string().trim().max(max).default("");

export type { ID };
