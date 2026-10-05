/**
 * Transport abstraction used by the UI. The demo transport runs procedures in the
 * browser against the BrowserRepository; the HTTP transport calls the server.
 */
import { AppError } from "@/lib/errors";

export interface SessionInfo {
  userId: string;
  companyId: string;
}

export type LoginResult = { ok: true } | { ok: false; error: string; needsTotp?: boolean };

export interface Transport {
  mode: "demo" | "production";
  init(onProgress?: (message: string) => void): Promise<void>;
  session(): Promise<SessionInfo | null>;
  login(email: string, password: string, totp?: string): Promise<LoginResult>;
  logout(): Promise<void>;
  switchCompany(companyId: string): Promise<void>;
  call(name: string, input: unknown): Promise<unknown>;
}

export class HttpTransport implements Transport {
  mode = "production" as const;

  async init() {}

  async session(): Promise<SessionInfo | null> {
    const res = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { session: SessionInfo | null };
    return body.session;
  }

  async login(email: string, password: string, totp?: string): Promise<LoginResult> {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password, totp }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; needsTotp?: boolean };
    if (res.ok) return { ok: true };
    return { ok: false, error: body.error ?? "Sign-in failed.", needsTotp: body.needsTotp };
  }

  async logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
  }

  async switchCompany(companyId: string) {
    const res = await fetch("/api/auth/switch-company", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ companyId }),
    });
    if (!res.ok) throw AppError.from(await res.json().catch(() => null));
  }

  async call(name: string, input: unknown) {
    const res = await fetch(`/api/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(input ?? {}),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw AppError.from(body?.error ?? body);
    return body?.data;
  }
}
