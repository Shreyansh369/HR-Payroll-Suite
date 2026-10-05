/**
 * Production server logic against PostgreSQL (PGlite): first-run setup, login,
 * sessions, rate limits, two-factor, production-mode procedures and Stripe
 * webhook entitlements.
 */
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { DatabaseDocumentStorage, DatabaseRepository } from "@/repositories/database/database-repository";
import { beginTwoFactor, changePassword, enableTwoFactor, login, resolveSession, switchSessionCompany, type AuthDeps } from "@/server/auth";
import { applyStripeEvent, hostedTrialEnd } from "@/server/billing";
import { buildCtx } from "@/server/context";
import { createFieldCipher, totpCode } from "@/server/crypto";
import { needsSetup, performSetup } from "@/server/setup";
import { execute } from "@/services/core";
import { procedures, type ProcedureName, type ProcInput, type ProcOutput } from "@/services/registry";
import { freshDatabase, TEST_KEY } from "./db";

const TOKEN = "test-setup-token-0123456789";
const PASSWORD = "correct horse battery staple";
const META = { ip: "203.0.113.10", userAgent: "vitest" };

async function installation(opts: { billing?: boolean } = {}) {
  const { db } = await freshDatabase();
  const cipher = createFieldCipher(TEST_KEY);
  const repo = new DatabaseRepository(db, { cipher });
  const storage = new DatabaseDocumentStorage(db);
  let clock = new Date("2026-10-05T12:00:00.000Z");
  const deps: AuthDeps = { db, repo, cipher, ttlHours: 12, now: () => clock };
  expect(await needsSetup(db)).toBe(true);
  const owner = await performSetup({ db, repo, setupToken: TOKEN }, {
    setupToken: TOKEN,
    organizationName: "Example Holdings",
    company: { legalName: "Example Trading Ltd.", shortName: "EXT", payFrequency: "monthly" },
    owner: { name: "Olivia Owner", email: "owner@example.com", password: PASSWORD },
  });
  const signIn = async (email = "owner@example.com", password = PASSWORD, totp?: string) => login(deps, { email, password, totp }, META);
  const caller = async (token: string) => {
    const session = (await resolveSession(deps, token))!;
    const ctx = await buildCtx({ repo, storage, billingEnabled: !!opts.billing, now: () => clock }, session, META);
    return <N extends ProcedureName>(name: N, input: ProcInput<N>) => execute(procedures[name] as never, ctx, input) as Promise<ProcOutput<N>>;
  };
  return { db, repo, deps, owner, signIn, caller, tick: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

describe("first-run setup", () => {
  it("requires the setup token, provisions draft rules and can only run once", async () => {
    const { db } = await freshDatabase();
    const repo = new DatabaseRepository(db, { cipher: createFieldCipher(TEST_KEY) });
    const input = { setupToken: "wrong-token-wrong-token", organizationName: "Org", company: { legalName: "Co Ltd", shortName: "CO" }, owner: { name: "Owner", email: "o@example.com", password: PASSWORD } };
    await expect(performSetup({ db, repo, setupToken: undefined }, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(performSetup({ db, repo, setupToken: TOKEN }, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(performSetup({ db, repo, setupToken: TOKEN }, { ...input, setupToken: TOKEN, owner: { ...input.owner, password: "short" } })).rejects.toMatchObject({ code: "VALIDATION" });
    const user = await performSetup({ db, repo, setupToken: TOKEN }, { ...input, setupToken: TOKEN });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    await expect(performSetup({ db, repo, setupToken: TOKEN }, { ...input, setupToken: TOKEN })).rejects.toMatchObject({ code: "CONFLICT" });
    const [company] = await repo.companies.listByOrganization(user.organizationId);
    const rules = await repo.statutoryRules.list(company.id);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.status === "draft")).toBe(true);
  });
});

describe("authentication", () => {
  it("signs in, resolves and expires sessions, and audits failures", async () => {
    const app = await installation();
    expect(await app.signIn("owner@example.com", "not the password")).toMatchObject({ ok: false, status: 401, error: "Email or password is incorrect." });
    expect(await app.signIn("nobody@example.com", PASSWORD)).toMatchObject({ ok: false, status: 401, error: "Email or password is incorrect." });
    const res = await app.signIn("OWNER@example.com ");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await resolveSession(app.deps, res.token))?.userId).toBe(app.owner.id);
    expect(await resolveSession(app.deps, "x".repeat(43))).toBeNull();
    app.tick(13 * 3600_000);
    expect(await resolveSession(app.deps, res.token)).toBeNull();
    const audit = await app.repo.audit.list(app.owner.organizationId, { action: "auth" });
    expect(audit.items.map((e) => e.action)).toEqual(expect.arrayContaining(["auth.login", "auth.login_failed"]));
  });

  it("rate limits repeated failures for an account", async () => {
    const app = await installation();
    for (let i = 0; i < 8; i++) expect((await app.signIn("owner@example.com", `wrong-${i}`)).ok).toBe(false);
    const blocked = await app.signIn();
    expect(blocked).toMatchObject({ ok: false, status: 429 });
    app.tick(16 * 60_000);
    expect((await app.signIn()).ok).toBe(true);
  });

  it("supports TOTP two-factor and revokes other sessions on password change", async () => {
    const app = await installation();
    const first = await app.signIn();
    if (!first.ok) throw new Error("login failed");
    let session = (await resolveSession(app.deps, first.token))!;
    const { secret } = await beginTwoFactor(app.deps, session, "Test");
    session = (await resolveSession(app.deps, first.token))!;
    await expect(enableTwoFactor(app.deps, session, "000000", META)).rejects.toMatchObject({ code: "VALIDATION" });
    const code = () => totpCode(secret, Math.floor(new Date("2026-10-05T12:00:00.000Z").getTime() / 30000));
    await enableTwoFactor(app.deps, session, code(), META);
    const raw = await app.repo.users.get(app.owner.id);
    expect(raw?.twoFactor?.secretEncrypted).toMatch(/^enc:v1:/);
    expect(await app.signIn()).toMatchObject({ ok: false, needsTotp: true });
    const second = await app.signIn("owner@example.com", PASSWORD, code());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    session = (await resolveSession(app.deps, second.token))!;
    await expect(changePassword(app.deps, session, "wrong", "another long passphrase", META)).rejects.toMatchObject({ code: "VALIDATION" });
    await changePassword(app.deps, session, PASSWORD, "another long passphrase", META);
    expect(await resolveSession(app.deps, first.token)).toBeNull();
    expect(await resolveSession(app.deps, second.token)).not.toBeNull();
  });

  it("never lets a session switch into another organisation's company", async () => {
    const app = await installation();
    const res = await app.signIn();
    if (!res.ok) throw new Error("login failed");
    const at = "2026-10-05T00:00:00.000Z";
    await app.repo.organizations.insert({ id: "org_other", name: "Other", kind: "customer", createdAt: at, updatedAt: at });
    const [mine] = await app.repo.companies.listByOrganization(app.owner.organizationId);
    await app.repo.companies.insert({ ...mine, id: "co_other", organizationId: "org_other", legalName: "Other Ltd" });
    const session = (await resolveSession(app.deps, res.token))!;
    await expect(switchSessionCompany(app.deps, session, "co_other", META)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("production-mode procedures", () => {
  it("hashes initial passwords, encrypts employee identifiers and blocks finalizing with unapproved rules", async () => {
    const app = await installation();
    const res = await app.signIn();
    if (!res.ok) throw new Error("login failed");
    const call = await app.caller(res.token);
    const ctx = await call("session.context", {});
    expect(ctx.mode).toBe("production");
    expect(ctx.entitlements.active).toBe(true);
    const roles = await call("roles.list", {});
    const hr = roles.find((r) => r.key === "hr_manager")!;
    await expect(call("users.create", { email: "hr@example.com", name: "Harper HR", memberships: [{ companyId: ctx.company.id, roleId: hr.id, scope: "all", employeeId: null, assignedEmployeeIds: [], extraPermissions: [] }] })).rejects.toMatchObject({ code: "VALIDATION" });
    await call("users.create", { email: "hr@example.com", name: "Harper HR", initialPassword: "initial passphrase 1", memberships: [{ companyId: ctx.company.id, roleId: hr.id, scope: "all", employeeId: null, assignedEmployeeIds: [], extraPermissions: [] }] });
    expect((await app.signIn("hr@example.com", "initial passphrase 1")).ok).toBe(true);

    const deps = await call("departments.list", {});
    expect(deps).toEqual([]);
    const created = await call("employees.create", {
      employeeCode: "EXT-001",
      firstName: "Sam",
      lastName: "Example",
      dateOfBirth: "1990-04-02",
      email: "sam@example.com",
      phone: "",
      address: { line1: "1 Main Street", city: "Road Town", country: "British Virgin Islands" },
      emergencyContact: { name: "", relationship: "", phone: "" },
      leavePolicyId: null,
      position: "Clerk",
      departmentId: null,
      managerId: null,
      employmentType: "full_time",
      hireDate: "2026-09-01",
      workLocation: "Road Town",
      statutoryIds: { socialSecurityNumber: "SS-123", nhiNumber: "NHI-9", taxId: "" },
      payProfile: { payMethod: "bank_transfer", bankName: "Example Bank", bankAccount: "000123456789" },
      rate: { payType: "salary", amount: 36000, basis: "annual", payFrequency: "monthly" },
      schedule: { workDays: [1, 2, 3, 4, 5], hoursPerDay: 8 },
    } as never);
    const stored = await app.repo.employees.get(ctx.company.id, (created as { id: string }).id);
    expect(stored?.statutoryIds.socialSecurityNumber).toBe("SS-123");
    const s = await call("payroll.runs.suggest", { frequency: "monthly" });
    expect(s.eligibleCount).toBe(1);
    const run = await call("payroll.runs.create", { type: "regular", payFrequency: "monthly", periodStart: s.start, periodEnd: s.end, payDate: s.payDate });
    await call("payroll.calculate", { runId: run.id });
    const detail = await call("payroll.runs.get", { id: run.id });
    expect(detail.run.preflight.issues.some((i) => i.code.startsWith("RULE_DRAFT_ONLY") && i.severity === "error")).toBe(true);
  });

  it("enforces subscription entitlements when billing is enabled", async () => {
    const app = await installation({ billing: true });
    const res = await app.signIn();
    if (!res.ok) throw new Error("login failed");
    const call = await app.caller(res.token);
    expect((await call("session.context", {})).entitlements.active).toBe(false);
    await expect(call("company.create", { legalName: "Second Ltd", shortName: "SEC" } as never)).rejects.toMatchObject({ code: "ENTITLEMENT" });
  });
});

describe("stripe webhooks", () => {
  const event = (id: string, type: string, object: unknown) => ({ id, type, data: { object } }) as unknown as Stripe.Event;

  it("activates plans only from verified events, idempotently, and never downgrades ownership", async () => {
    const app = await installation({ billing: true });
    const orgId = app.owner.organizationId;
    const sub = (status: string) => ({ id: "sub_1", status, customer: "cus_1", trial_start: 1791200000, trial_end: hostedTrialEnd(new Date("2026-10-05T12:00:00Z")), metadata: { organizationId: orgId } }) as unknown as Stripe.Subscription;
    const deps = { db: app.db, repo: app.repo, retrieveSubscription: async () => sub("trialing") };

    const completed = event("evt_1", "checkout.session.completed", { id: "cs_1", mode: "subscription", subscription: "sub_1", customer: "cus_1", metadata: { organizationId: orgId, plan: "hosted" }, client_reference_id: orgId });
    expect(await applyStripeEvent(deps, completed)).toBe(true);
    expect(await applyStripeEvent(deps, completed)).toBe(false);
    let license = await app.repo.licenses.getByOrganization(orgId);
    expect(license).toMatchObject({ plan: "hosted", status: "trialing", stripeCustomerId: "cus_1" });
    expect(license!.trialEnd!.slice(0, 10)).toBe("2026-12-05");

    expect(await applyStripeEvent(deps, event("evt_2", "customer.subscription.updated", sub("past_due")))).toBe(true);
    expect((await app.repo.licenses.getByOrganization(orgId))?.status).toBe("past_due");

    const paid = event("evt_3", "checkout.session.completed", { id: "cs_2", mode: "payment", payment_status: "paid", customer: "cus_1", metadata: { organizationId: orgId, plan: "owned" } });
    expect(await applyStripeEvent(deps, paid)).toBe(true);
    license = await app.repo.licenses.getByOrganization(orgId);
    expect(license).toMatchObject({ plan: "owned", status: "owned", maintenanceUntil: "2027-01-05", subscriptionFreeUntil: "2027-10-05" });
    expect(await applyStripeEvent(deps, event("evt_4", "customer.subscription.deleted", sub("canceled")))).toBe(false);
    expect((await app.repo.licenses.getByOrganization(orgId))?.status).toBe("owned");

    const unpaid = event("evt_5", "checkout.session.completed", { id: "cs_3", mode: "payment", payment_status: "unpaid", customer: "cus_1", metadata: { organizationId: orgId } });
    expect(await applyStripeEvent(deps, unpaid)).toBe(false);
  });
});
