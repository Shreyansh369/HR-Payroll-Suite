/**
 * In-browser demo transport. Runs the same procedures as the server, against
 * fictional data persisted locally. No network or database is used.
 */
import type { LoginResult, SessionInfo, Transport } from "@/client/transport";
import { BrowserDocumentStorage, BrowserRepository, STATE_KEY } from "@/repositories/browser/browser-repository";
import { createDemoStorage, type DemoStorage } from "@/repositories/browser/demo-storage";
import { STATE_VERSION, type RepositoryState } from "@/repositories/memory/memory-repository";
import { buildDemoSeed, DEMO_PASSWORD } from "@/repositories/demo/seed";
import { resolveActor } from "@/services/authz";
import { audit, execute, type Ctx } from "@/services/core";
import { demoEntitlements } from "@/services/entitlements";
import { getProcedure } from "@/services/registry";
import { AppError } from "@/lib/errors";
import { randomId } from "@/lib/ids";
import { todayISO } from "@/lib/dates";

const SESSION_KEY = "demo-session";
const META_KEY = "demo-meta";

export interface DemoMeta {
  seededOn: string;
  seededAt: string;
}

export class DemoTransport implements Transport {
  mode = "demo" as const;
  private storage!: DemoStorage;
  private repo!: BrowserRepository;
  private docs!: BrowserDocumentStorage;
  private ready: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  init(onProgress?: (message: string) => void) {
    if (!this.ready) this.ready = this.load(onProgress);
    return this.ready;
  }

  private async load(onProgress?: (message: string) => void) {
    this.storage = await createDemoStorage();
    this.docs = new BrowserDocumentStorage(this.storage);
    let state = await this.storage.load<RepositoryState>(STATE_KEY);
    if (!state || state.version !== STATE_VERSION) {
      onProgress?.("Preparing fictional demo companies and payroll history…");
      state = await this.seed();
    }
    this.repo = new BrowserRepository(state, this.storage);
  }

  private async seed(): Promise<RepositoryState> {
    const today = todayISO("America/Tortola");
    const { state, blobs } = await buildDemoSeed(today);
    await this.storage.clear();
    for (const [key, bytes] of blobs) await this.docs.put(key, bytes);
    await this.storage.save(STATE_KEY, state);
    await this.storage.save<DemoMeta>(META_KEY, { seededOn: today, seededAt: new Date().toISOString() });
    return state;
  }

  /** Serialise all operations so in-memory transactions never interleave. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async meta(): Promise<DemoMeta | null> {
    await this.init();
    return this.storage.load<DemoMeta>(META_KEY);
  }

  async session(): Promise<SessionInfo | null> {
    await this.init();
    const s = await this.storage.load<SessionInfo>(SESSION_KEY);
    if (!s) return null;
    const user = await this.repo.users.get(s.userId);
    return user && user.status === "active" ? s : null;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    await this.init();
    const user = await this.repo.users.getByEmail(email);
    if (!user || password !== DEMO_PASSWORD) return { ok: false, error: "Email or password is incorrect. Use one of the demo accounts listed below." };
    if (user.status !== "active" || user.memberships.length === 0) return { ok: false, error: "This account is disabled." };
    await this.startSession(user.id, user.memberships[0].companyId, "auth.login");
    return { ok: true };
  }

  /** Quick role switch for demo walkthroughs (fictional data only). */
  async switchUser(email: string): Promise<void> {
    await this.init();
    const user = await this.repo.users.getByEmail(email);
    if (!user || user.status !== "active" || user.memberships.length === 0) throw new AppError("NOT_FOUND", "Demo account not found.");
    await this.startSession(user.id, user.memberships[0].companyId, "auth.demo_switch");
  }

  private async startSession(userId: string, companyId: string, action: string) {
    await this.exclusive(async () => {
      await this.repo.users.update(userId, { lastLoginAt: new Date().toISOString() });
      await this.storage.save<SessionInfo>(SESSION_KEY, { userId, companyId });
      const ctx = await this.ctx({ userId, companyId });
      await audit(ctx, { action, entityType: "user", entityId: userId, companyId: null, summary: `${ctx.actor.name} signed in to the demo` });
    });
  }

  async logout() {
    await this.init();
    await this.storage.remove(SESSION_KEY);
  }

  async switchCompany(companyId: string) {
    await this.init();
    const s = await this.session();
    if (!s) throw new AppError("UNAUTHENTICATED", "Sign in again.");
    await this.exclusive(async () => {
      const actor = await resolveActor(this.repo, s.userId, companyId);
      if (actor.companyId !== companyId) throw new AppError("FORBIDDEN", "You do not have access to this company.");
      await this.storage.save<SessionInfo>(SESSION_KEY, { userId: s.userId, companyId });
      const ctx = await this.ctx({ userId: s.userId, companyId });
      const company = await this.repo.companies.get(companyId);
      await audit(ctx, { action: "auth.company_switched", entityType: "company", entityId: companyId, summary: `Switched to ${company?.tradingName ?? companyId}` });
    });
  }

  private async ctx(s: SessionInfo): Promise<Ctx> {
    return {
      actor: await resolveActor(this.repo, s.userId, s.companyId),
      repo: this.repo,
      storage: this.docs,
      mode: "demo",
      entitlements: demoEntitlements(),
      now: () => new Date(),
      ids: (p) => randomId(p),
    };
  }

  async call(name: string, input: unknown) {
    await this.init();
    const proc = getProcedure(name);
    if (!proc) throw new AppError("NOT_FOUND", `Unknown action ${name}.`);
    return this.exclusive(async () => {
      const s = await this.storage.load<SessionInfo>(SESSION_KEY);
      if (!s) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again.");
      const ctx = await this.ctx(s);
      try {
        return await execute(proc, ctx, structuredClone(input ?? {}));
      } catch (e) {
        if (e instanceof AppError) throw e;
        console.error(e);
        throw new AppError("INTERNAL", e instanceof Error ? e.message : "Unexpected error");
      }
    });
  }

  /** Restore the original fictional dataset. Keeps the current user signed in when possible. */
  async reset(): Promise<void> {
    await this.init();
    const session = await this.storage.load<SessionInfo>(SESSION_KEY);
    const email = session ? (await this.repo.users.get(session.userId))?.email : null;
    await this.exclusive(async () => {
      await this.repo.flush();
      const state = await this.seed();
      this.repo = new BrowserRepository(state, this.storage);
    });
    if (email) await this.switchUser(email);
  }

  /** Full JSON export of the demo store (fictional data). */
  async exportState(): Promise<RepositoryState> {
    await this.init();
    return this.repo.snapshot();
  }
}
