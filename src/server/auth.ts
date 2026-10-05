/**
 * Authentication and sessions (production mode).
 *
 * - Passwords: scrypt (src/server/crypto.ts).
 * - Sessions: random 256-bit token in an HttpOnly, SameSite=Lax, Secure cookie;
 *   only its SHA-256 is stored. Idle timeout with sliding renewal, plus an
 *   absolute lifetime.
 * - Rate limits: database-backed fixed windows per IP and per account.
 * - Two-factor: optional TOTP; the secret is stored encrypted.
 *
 * Functions take explicit dependencies so they can be tested against PGlite.
 */
import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { companies, rateLimits, sessions } from "@/db/schema";
import type { Db } from "@/repositories/database/database-repository";
import type { Repository } from "@/repositories/interfaces";
import type { User } from "@/domain/types";
import { resolveActor } from "@/services/authz";
import { randomId } from "@/lib/ids";
import { AppError } from "@/lib/errors";
import { generateTotpSecret, hashPassword, randomToken, sha256, totpUri, verifyPassword, verifyTotp, type FieldCipher } from "@/server/crypto";

export interface AuthDeps {
  db: Db;
  repo: Repository;
  cipher: FieldCipher;
  ttlHours: number;
  now?: () => Date;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  companyId: string;
  user: User;
}

const ABSOLUTE_LIFETIME_DAYS = 7;
const RENEW_AFTER_MS = 5 * 60 * 1000;
const now = (d: AuthDeps) => (d.now ? d.now() : new Date());

/* ------------------------------------------------------------------ rate limiting */

/** Fixed-window counter. Returns whether the call is allowed and seconds until the window resets. */
export async function consumeRateLimit(db: Db, key: string, limit: number, windowSeconds: number, at = new Date()): Promise<{ allowed: boolean; retryAfter: number }> {
  const nowIso = at.toISOString();
  const cutoff = new Date(at.getTime() - windowSeconds * 1000).toISOString();
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: nowIso, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} < ${cutoff} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} < ${cutoff} then ${nowIso}::timestamptz else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart });
  const resetAt = new Date(row.windowStart).getTime() + windowSeconds * 1000;
  return { allowed: row.count <= limit, retryAfter: Math.max(1, Math.ceil((resetAt - at.getTime()) / 1000)) };
}

export async function clearRateLimit(db: Db, key: string) {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

/* ------------------------------------------------------------------ sessions */

async function createSession(deps: AuthDeps, user: User, companyId: string, meta: RequestMeta): Promise<string> {
  const token = randomToken(32);
  const at = now(deps);
  await deps.db.insert(sessions).values({
    id: sha256(token),
    userId: user.id,
    companyId,
    createdAt: at.toISOString(),
    lastSeenAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + deps.ttlHours * 3600_000).toISOString(),
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export async function resolveSession(deps: AuthDeps, token: string | null | undefined): Promise<SessionRecord | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const id = sha256(token);
  const [s] = await deps.db.select().from(sessions).where(eq(sessions.id, id));
  if (!s) return null;
  const at = now(deps);
  const absoluteEnd = new Date(s.createdAt).getTime() + ABSOLUTE_LIFETIME_DAYS * 86400_000;
  if (new Date(s.expiresAt).getTime() <= at.getTime() || absoluteEnd <= at.getTime()) {
    await deps.db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  const user = await deps.repo.users.get(s.userId);
  if (!user || user.status !== "active" || !user.memberships.some((m) => m.companyId === s.companyId)) {
    await deps.db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (at.getTime() - new Date(s.lastSeenAt).getTime() > RENEW_AFTER_MS) {
    await deps.db
      .update(sessions)
      .set({ lastSeenAt: at.toISOString(), expiresAt: new Date(Math.min(absoluteEnd, at.getTime() + deps.ttlHours * 3600_000)).toISOString() })
      .where(eq(sessions.id, id));
  }
  return { id, userId: s.userId, companyId: s.companyId, user };
}

export async function revokeSession(deps: AuthDeps, token: string | null | undefined) {
  if (token) await deps.db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function revokeOtherSessions(deps: AuthDeps, userId: string, keepSessionId: string | null) {
  const all = await deps.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  for (const s of all) if (s.id !== keepSessionId) await deps.db.delete(sessions).where(eq(sessions.id, s.id));
}

export async function purgeExpiredSessions(deps: AuthDeps) {
  await deps.db.delete(sessions).where(lt(sessions.expiresAt, now(deps).toISOString()));
}

export async function switchSessionCompany(deps: AuthDeps, session: SessionRecord, companyId: string, meta: RequestMeta) {
  const actor = await resolveActor(deps.repo, session.userId, companyId);
  if (actor.companyId !== companyId) throw new AppError("FORBIDDEN", "You do not have access to this company.");
  await deps.db.update(sessions).set({ companyId }).where(eq(sessions.id, session.id));
  const company = await deps.repo.companies.get(companyId);
  await deps.repo.audit.append({
    id: randomId("aud"),
    organizationId: session.user.organizationId,
    companyId,
    at: now(deps).toISOString(),
    actorId: session.userId,
    actorName: session.user.name,
    action: "auth.company_switched",
    entityType: "company",
    entityId: companyId,
    summary: `Switched to ${company?.tradingName ?? companyId}`,
    meta,
  });
}

/* ------------------------------------------------------------------ login */

export type LoginOutcome =
  | { ok: true; token: string; user: User; companyId: string }
  | { ok: false; status: number; error: string; needsTotp?: boolean; retryAfter?: number };

const GENERIC = "Email or password is incorrect.";

export async function login(deps: AuthDeps, input: { email: string; password: string; totp?: string }, meta: RequestMeta): Promise<LoginOutcome> {
  const email = input.email.trim().toLowerCase();
  const ipLimit = await consumeRateLimit(deps.db, `login:ip:${meta.ip ?? "unknown"}`, 30, 15 * 60, now(deps));
  if (!ipLimit.allowed) return { ok: false, status: 429, error: "Too many sign-in attempts. Try again later.", retryAfter: ipLimit.retryAfter };
  const accountLimit = await consumeRateLimit(deps.db, `login:account:${sha256(email)}`, 8, 15 * 60, now(deps));
  if (!accountLimit.allowed) return { ok: false, status: 429, error: "Too many attempts for this account. Try again in a few minutes.", retryAfter: accountLimit.retryAfter };

  const user = await deps.repo.users.getByEmail(email);
  const passwordOk = await verifyPassword(input.password, user?.passwordHash);
  const audit = async (action: string, summary: string, u: User) =>
    deps.repo.audit.append({ id: randomId("aud"), organizationId: u.organizationId, companyId: null, at: now(deps).toISOString(), actorId: u.id, actorName: u.name, action, entityType: "user", entityId: u.id, summary, meta });

  if (!user || !passwordOk) {
    if (user) await audit("auth.login_failed", `Failed sign-in for ${user.email}`, user);
    return { ok: false, status: 401, error: GENERIC };
  }
  if (user.status !== "active" || user.memberships.length === 0) return { ok: false, status: 403, error: "This account is disabled. Contact your administrator." };

  if (user.twoFactor?.enabled) {
    if (!input.totp) return { ok: false, status: 401, error: "Enter the 6-digit code from your authenticator app.", needsTotp: true };
    const secret = user.twoFactor.secretEncrypted ? deps.cipher.decrypt(user.twoFactor.secretEncrypted) : "";
    if (!secret || !verifyTotp(secret, input.totp, now(deps).getTime())) {
      await audit("auth.login_failed", `Invalid two-factor code for ${user.email}`, user);
      return { ok: false, status: 401, error: "That code is not valid. Check your device's time and try again.", needsTotp: true };
    }
  }

  // Prefer a company that still exists and that the user can access.
  let companyId: string | null = null;
  for (const m of user.memberships) {
    const [c] = await deps.db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, m.companyId), eq(companies.organizationId, user.organizationId)));
    if (c) {
      companyId = c.id;
      break;
    }
  }
  if (!companyId) return { ok: false, status: 403, error: "Your account has no company access. Contact your administrator." };

  await clearRateLimit(deps.db, `login:account:${sha256(email)}`);
  const token = await createSession(deps, user, companyId, meta);
  await deps.repo.users.update(user.id, { lastLoginAt: now(deps).toISOString() });
  await audit("auth.login", `${user.name} signed in`, user);
  return { ok: true, token, user, companyId };
}

/* ------------------------------------------------------------------ account security */

export async function changePassword(deps: AuthDeps, session: SessionRecord, current: string, next: string, meta: RequestMeta) {
  const limit = await consumeRateLimit(deps.db, `password:${session.userId}`, 10, 15 * 60, now(deps));
  if (!limit.allowed) throw new AppError("RATE_LIMITED", "Too many attempts. Try again later.");
  if (!(await verifyPassword(current, session.user.passwordHash))) throw new AppError("VALIDATION", "Your current password is incorrect.");
  if (next.length < 12) throw new AppError("VALIDATION", "Use at least 12 characters.");
  if (next.toLowerCase() === session.user.email.toLowerCase()) throw new AppError("VALIDATION", "Your password cannot be your email address.");
  await deps.repo.users.update(session.userId, { passwordHash: await hashPassword(next), updatedAt: now(deps).toISOString() });
  await revokeOtherSessions(deps, session.userId, session.id);
  await deps.repo.audit.append({ id: randomId("aud"), organizationId: session.user.organizationId, companyId: null, at: now(deps).toISOString(), actorId: session.userId, actorName: session.user.name, action: "auth.password_changed", entityType: "user", entityId: session.userId, summary: "Changed password and signed out other sessions", meta });
}

export async function beginTwoFactor(deps: AuthDeps, session: SessionRecord, issuer: string) {
  if (session.user.twoFactor?.enabled) throw new AppError("INVALID_STATE", "Two-factor authentication is already on.");
  const secret = generateTotpSecret();
  await deps.repo.users.update(session.userId, { twoFactor: { enabled: false, secretEncrypted: deps.cipher.encrypt(secret) } });
  return { secret, uri: totpUri(secret, session.user.email, issuer) };
}

export async function enableTwoFactor(deps: AuthDeps, session: SessionRecord, code: string, meta: RequestMeta) {
  const pending = session.user.twoFactor?.secretEncrypted;
  if (!pending || session.user.twoFactor?.enabled) throw new AppError("INVALID_STATE", "Start two-factor setup first.");
  if (!verifyTotp(deps.cipher.decrypt(pending), code, now(deps).getTime())) throw new AppError("VALIDATION", "That code is not valid. Check your device's time and try again.");
  await deps.repo.users.update(session.userId, { twoFactor: { enabled: true, secretEncrypted: pending } });
  await deps.repo.audit.append({ id: randomId("aud"), organizationId: session.user.organizationId, companyId: null, at: now(deps).toISOString(), actorId: session.userId, actorName: session.user.name, action: "auth.2fa_enabled", entityType: "user", entityId: session.userId, summary: "Turned on two-factor authentication", meta });
}

export async function disableTwoFactor(deps: AuthDeps, session: SessionRecord, password: string, meta: RequestMeta) {
  if (!(await verifyPassword(password, session.user.passwordHash))) throw new AppError("VALIDATION", "Your password is incorrect.");
  await deps.repo.users.update(session.userId, { twoFactor: null });
  await deps.repo.audit.append({ id: randomId("aud"), organizationId: session.user.organizationId, companyId: null, at: now(deps).toISOString(), actorId: session.userId, actorName: session.user.name, action: "auth.2fa_disabled", entityType: "user", entityId: session.userId, summary: "Turned off two-factor authentication", meta });
}
