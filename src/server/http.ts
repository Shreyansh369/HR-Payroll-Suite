/**
 * HTTP helpers for route handlers: cookies, same-origin (CSRF) checks, request
 * metadata and consistent JSON errors.
 */
import "server-only";
import { AppError } from "@/lib/errors";
import { resolveSession, type AuthDeps, type RequestMeta, type SessionRecord } from "@/server/auth";
import { runtime } from "@/server/runtime";
import { serverEnv } from "@/server/env";

export function isSecureDeployment(): boolean {
  const env = serverEnv();
  return env.APP_URL ? env.APP_URL.startsWith("https://") : process.env.NODE_ENV === "production";
}

/** `__Host-` cookies are bound to the exact origin and require HTTPS. */
export function sessionCookieName(): string {
  return isSecureDeployment() ? "__Host-hps_session" : "hps_session";
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return [`${sessionCookieName()}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`, isSecureDeployment() ? "Secure" : ""].filter(Boolean).join("; ");
}

export function clearSessionCookie(): string {
  return [`${sessionCookieName()}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", isSecureDeployment() ? "Secure" : ""].filter(Boolean).join("; ");
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function requestMeta(req: Request): RequestMeta {
  const env = serverEnv();
  const forwarded = env.TRUST_PROXY ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") : null;
  return { ip: forwarded ?? null, userAgent: req.headers.get("user-agent") };
}

/**
 * Rejects cross-site state-changing requests. Combined with SameSite=Lax cookies
 * and the JSON content-type requirement this blocks CSRF without tokens.
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  const env = serverEnv();
  const expected = new Set<string>();
  if (env.APP_URL) expected.add(new URL(env.APP_URL).host);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) expected.add(host);
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError("FORBIDDEN", "Cross-site request blocked.");
    }
    if (!expected.has(originHost)) throw new AppError("FORBIDDEN", "Cross-site request blocked.");
  } else if (site && site !== "same-origin" && site !== "none") {
    throw new AppError("FORBIDDEN", "Cross-site request blocked.");
  }
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new AppError("VALIDATION", "Requests must be JSON.");
}

export function authDeps(): AuthDeps {
  const rt = runtime();
  return { db: rt.db, repo: rt.repo, cipher: rt.cipher, ttlHours: serverEnv().SESSION_TTL_HOURS };
}

export async function currentSession(req: Request): Promise<SessionRecord | null> {
  return resolveSession(authDeps(), readCookie(req, sessionCookieName()));
}

export async function requireSession(req: Request): Promise<SessionRecord> {
  const s = await currentSession(req);
  if (!s) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again.");
  return s;
}

export async function readJson(req: Request, maxBytes = 15 * 1024 * 1024): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new AppError("VALIDATION", "Request is too large.");
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("VALIDATION", "Request is too large.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION", "Malformed JSON.");
  }
}

const NO_STORE = { "cache-control": "no-store" };

export function ok(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return Response.json(data, { status: init.status ?? 200, headers: { ...NO_STORE, ...init.headers } });
}

export function fail(e: unknown, headers: Record<string, string> = {}) {
  const err = e instanceof AppError ? e : null;
  if (!err) console.error("[api] unexpected error", e);
  const safe = err ?? new AppError("INTERNAL", "Something went wrong. Please try again.");
  return Response.json({ error: safe.toJSON() }, { status: safe.status, headers: { ...NO_STORE, ...headers } });
}

/** Wraps a handler: demo deployments expose no server API; errors become JSON. */
export function api(handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    if (serverEnv().DEMO_MODE) return Response.json({ error: { code: "NOT_FOUND", message: "Not available in demo mode." } }, { status: 404 });
    try {
      return await handler(req, ctx);
    } catch (e) {
      return fail(e);
    }
  };
}
