/**
 * Repository contract: the in-memory (demo) and PostgreSQL (production)
 * implementations must behave identically for every query the services use.
 */
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Company, Department, Organization, PayrollRun } from "@/domain/types";
import type { Repository } from "@/repositories/interfaces";
import { InMemoryRepository } from "@/repositories/memory/memory-repository";
import { DatabaseRepository } from "@/repositories/database/database-repository";
import { createFieldCipher } from "@/server/crypto";
import { freshDatabase, seededDatabase, TEST_KEY } from "./db";

const NOW = "2026-10-05T12:00:00.000Z";

async function baseline(repo: Repository) {
  const org: Organization = { id: "org_1", name: "Contract Org", kind: "customer", createdAt: NOW, updatedAt: NOW };
  await repo.organizations.insert(org);
  const company = (id: string, name: string) =>
    ({ id, organizationId: org.id, legalName: name, tradingName: name, createdAt: NOW, updatedAt: NOW }) as unknown as Company;
  await repo.companies.insert(company("cmp_a", "Alpha Ltd"));
  await repo.companies.insert(company("cmp_b", "Beta Ltd"));
  const dep = (id: string, companyId: string, name: string, code: string, parentId: string | null = null): Department => ({ id, companyId, name, code, parentId, createdAt: NOW, updatedAt: NOW });
  await repo.departments.insertMany([
    dep("dep_1", "cmp_a", "Front Office", "FO"),
    dep("dep_2", "cmp_a", "housekeeping", "HK", "dep_1"),
    dep("dep_3", "cmp_a", "Kitchen", "KIT"),
    dep("dep_4", "cmp_a", "Bar & Lounge", "BAR", "dep_3"),
    dep("dep_5", "cmp_b", "Marine Ops", "OPS"),
  ]);
  const run = (id: string, periodStart: string, periodEnd: string, status: PayrollRun["status"], type: PayrollRun["type"] = "regular") =>
    ({ id, companyId: "cmp_a", name: id, type, payFrequency: "monthly", periodStart, periodEnd, payDate: periodEnd, status, correctsRunId: null, createdAt: NOW, updatedAt: NOW }) as unknown as PayrollRun;
  await repo.payrollRuns.insertMany([run("run_jul", "2026-07-01", "2026-07-31", "locked"), run("run_aug", "2026-08-01", "2026-08-31", "finalized"), run("run_sep", "2026-09-01", "2026-09-30", "draft")]);
}

const BACKENDS: { name: string; make: () => Promise<Repository> }[] = [
  { name: "memory", make: async () => new InMemoryRepository() },
  {
    name: "postgres",
    make: async () => {
      const { db } = await freshDatabase();
      return new DatabaseRepository(db, { cipher: createFieldCipher(TEST_KEY) });
    },
  },
];

describe.each(BACKENDS)("$name repository contract", ({ make }) => {
  it("filters, searches, orders and pages identically", async () => {
    const repo = await make();
    await baseline(repo);
    const names = (rows: Department[]) => rows.map((d) => d.name);
    expect(names(await repo.departments.list("cmp_a"))).toEqual(["Bar & Lounge", "Front Office", "housekeeping", "Kitchen"]);
    expect(names(await repo.departments.list("cmp_a", { where: { parentId: null } }))).toEqual(["Front Office", "Kitchen"]);
    expect(names(await repo.departments.list("cmp_a", { where: { code: ["HK", "KIT", "NOPE"] } }))).toEqual(["housekeeping", "Kitchen"]);
    expect(await repo.departments.list("cmp_a", { where: { code: [] } })).toEqual([]);
    expect(names(await repo.departments.list("cmp_a", { search: "o" }))).toEqual(["Bar & Lounge", "Front Office", "housekeeping"]);
    expect(names(await repo.departments.list("cmp_a", { search: "front off" }))).toEqual(["Front Office"]);
    expect(names(await repo.departments.list("cmp_a", { search: "%" }))).toEqual([]);
    expect(names(await repo.departments.list("cmp_a", { orderBy: [{ field: "code", dir: "desc" }], limit: 2, offset: 1 }))).toEqual(["housekeeping", "Front Office"]);
    const page = await repo.departments.page("cmp_a", { limit: 2, offset: 2 });
    expect(page.total).toBe(4);
    expect(names(page.items)).toEqual(["housekeeping", "Kitchen"]);
    expect(await repo.departments.count("cmp_a", { search: "kit" })).toBe(1);
    const runs = (q: Parameters<Repository["payrollRuns"]["list"]>[1]) => repo.payrollRuns.list("cmp_a", q).then((r) => r.map((x) => x.id));
    expect(await runs({})).toEqual(["run_sep", "run_aug", "run_jul"]);
    expect(await runs({ range: { field: "periodStart", gte: "2026-08-01" } })).toEqual(["run_sep", "run_aug"]);
    expect(await runs({ range: { field: "periodEnd", lte: "2026-08-15" } })).toEqual(["run_jul"]);
    expect(await runs({ overlaps: { startField: "periodStart", endField: "periodEnd", start: "2026-07-20", end: "2026-08-02" } })).toEqual(["run_aug", "run_jul"]);
    expect(await runs({ where: { status: ["finalized", "locked"] }, orderBy: [{ field: "periodStart", dir: "asc" }] })).toEqual(["run_jul", "run_aug"]);
  });

  it("isolates tenants, enforces uniqueness and reports missing records", async () => {
    const repo = await make();
    await baseline(repo);
    expect(await repo.departments.get("cmp_b", "dep_1")).toBeNull();
    expect((await repo.departments.list("cmp_b")).map((d) => d.code)).toEqual(["OPS"]);
    await expect(repo.departments.update("cmp_b", "dep_1", { name: "Hijack" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.departments.remove("cmp_b", "dep_1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(repo.departments.insert({ id: "dep_9", companyId: "cmp_a", name: "Dup", code: "fo", parentId: null, createdAt: NOW, updatedAt: NOW })).rejects.toMatchObject({ code: "CONFLICT", message: "A department with this code already exists." });
    // Same code in another company is fine.
    await repo.departments.insert({ id: "dep_10", companyId: "cmp_b", name: "Front", code: "FO", parentId: null, createdAt: NOW, updatedAt: NOW });
    await expect(repo.payrollRuns.insert({ ...(await repo.payrollRuns.get("cmp_a", "run_sep"))!, id: "run_dup" })).rejects.toMatchObject({ code: "CONFLICT", message: "A regular payroll run already exists for this period." });
    await repo.payrollRuns.insert({ ...(await repo.payrollRuns.get("cmp_a", "run_sep"))!, id: "run_offcycle", type: "off_cycle" });
    const updated = await repo.departments.update("cmp_a", "dep_2", { name: "Housekeeping" });
    expect(updated).toMatchObject({ id: "dep_2", companyId: "cmp_a", name: "Housekeeping", code: "HK" });
    expect((await repo.departments.get("cmp_a", "dep_2"))!.name).toBe("Housekeeping");
    await expect(repo.departments.update("cmp_a", "dep_2", { code: "KIT" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rolls back every write when a transaction fails", async () => {
    const repo = await make();
    await baseline(repo);
    await expect(
      repo.transaction(async (tx) => {
        await tx.departments.update("cmp_a", "dep_1", { name: "Changed" });
        await tx.departments.insert({ id: "dep_new", companyId: "cmp_a", name: "New", code: "NEW", parentId: null, createdAt: NOW, updatedAt: NOW });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await repo.departments.get("cmp_a", "dep_1"))!.name).toBe("Front Office");
    expect(await repo.departments.get("cmp_a", "dep_new")).toBeNull();
  });

  it("keeps users unique by email (case-insensitive) and audit filtered by organisation", async () => {
    const repo = await make();
    await baseline(repo);
    const user = { id: "usr_1", organizationId: "org_1", email: "owner@example.com", name: "Owner", status: "active" as const, memberships: [], passwordHash: "scrypt$x", twoFactor: null, createdAt: NOW, updatedAt: NOW };
    await repo.users.insert(user);
    await expect(repo.users.insert({ ...user, id: "usr_2", email: "OWNER@example.com" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repo.users.getByEmail(" Owner@Example.com "))!.id).toBe("usr_1");
    expect((await repo.users.get("usr_1"))!.passwordHash).toBe("scrypt$x");
    for (const [i, action] of ["payroll.calculated", "payroll.finalized", "employee.updated"].entries()) {
      await repo.audit.append({ id: `aud_${i}`, organizationId: "org_1", companyId: "cmp_a", at: `2026-10-0${i + 1}T10:00:00.000Z`, actorId: "usr_1", actorName: "Owner", action, entityType: "x", entityId: null, summary: `Event ${i}` });
    }
    const page = await repo.audit.list("org_1", { action: "payroll", limit: 10 });
    expect(page.items.map((e) => e.id)).toEqual(["aud_1", "aud_0"]);
    expect((await repo.audit.list("org_1", { search: "event 2" })).total).toBe(1);
    expect((await repo.audit.list("org_1", { companyId: null })).total).toBe(0);
  });
});

describe("postgres-only guarantees", () => {
  it("encrypts statutory IDs and bank accounts at rest and never stores password hashes in documents", async () => {
    const { db, repo } = await seededDatabase();
    const raw = await db.execute(sql`select doc from employees limit 1`);
    const doc = (raw as unknown as { rows: { doc: { statutoryIds: Record<string, string>; payProfile: { bankAccount: string } } }[] }).rows[0].doc;
    expect(doc.statutoryIds.socialSecurityNumber).toMatch(/^enc:v1:/);
    expect(doc.payProfile.bankAccount).toMatch(/^enc:v1:/);
    const companies = await repo.companies.listByOrganization((await repo.organizations.list())[0].id);
    const [e] = await repo.employees.list(companies[0].id, { limit: 1 });
    expect(e.statutoryIds.socialSecurityNumber).not.toMatch(/^enc:/);
    const users = await db.execute(sql`select count(*)::int as n from users where doc ? 'passwordHash'`);
    expect((users as unknown as { rows: { n: number }[] }).rows[0].n).toBe(0);
  });

  it("rejects audit changes, demo organisations and edits to finalized payroll at the database level", async () => {
    const { db } = await seededDatabase();
    await expect(db.execute(sql`update audit_events set summary = 'tampered'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_events`)).rejects.toThrow();
    await expect(db.execute(sql`insert into organizations (id, name, kind, doc, created_at, updated_at) values ('org_demo', 'Demo', 'demo', '{}', now(), now())`)).rejects.toThrow();
    await expect(db.execute(sql`delete from payroll_results where run_id in (select id from payroll_runs where status = 'locked')`)).rejects.toThrow();
    await expect(db.execute(sql`delete from payroll_runs where status = 'locked'`)).rejects.toThrow();
    await expect(db.execute(sql`update statutory_rules set effective_to = '2000-01-01'`)).rejects.toThrow();
  });
});
