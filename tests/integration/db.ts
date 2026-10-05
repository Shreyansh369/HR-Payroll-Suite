/**
 * PostgreSQL test harness: PGlite (real Postgres compiled to WASM) with the
 * production migrations applied. Used by contract and workflow tests so the
 * DatabaseRepository is verified against the same expectations as memory.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { DatabaseDocumentStorage, DatabaseRepository, type Db } from "@/repositories/database/database-repository";
import type { RepositoryState } from "@/repositories/memory/memory-repository";
import type { CompanyScoped, PayrollRun, StatutoryRule } from "@/domain/types";
import { createFieldCipher } from "@/server/crypto";
import { TODAY, seedState } from "./helpers";

export const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

export async function freshDatabase() {
  const pg = new PGlite();
  const db = drizzle(pg) as unknown as Db;
  await migrate(drizzle(pg), { migrationsFolder: "drizzle" });
  return { pg, db };
}

/** Production databases never contain demo organisations or unapproved demo rules. */
function forProduction(state: RepositoryState): RepositoryState {
  const s = structuredClone(state);
  for (const o of Object.values(s.organizations)) o.kind = "customer";
  for (const [id, l] of Object.entries(s.licenses)) if (l.plan === "demo") delete s.licenses[id];
  for (const r of Object.values(s.tenant.statutoryRules) as unknown as StatutoryRule[]) {
    if (r.status === "demo") {
      r.status = "approved";
      r.approval = { approvedBy: "test", approvedByName: "Test fixture", approvedAt: `${TODAY}T00:00:00.000Z`, note: "Test fixture values, not legal rates." };
    }
  }
  return s;
}

const ORDER = [
  "departments",
  "leaveTypes",
  "leavePolicies",
  "employees",
  "employmentEvents",
  "payRates",
  "schedules",
  "payItems",
  "loans",
  "leaveRequests",
  "leaveLedger",
  "timesheets",
  "attendanceCorrections",
  "documents",
  "workflows",
  "statutoryRules",
  "payrollRuns",
  "payrollResults",
  "importBatches",
] as const;

export async function loadState(repo: DatabaseRepository, state: RepositoryState) {
  const s = forProduction(state);
  await repo.transaction(async (r) => {
    for (const o of Object.values(s.organizations)) await r.organizations.insert(o);
    for (const c of Object.values(s.companies)) await r.companies.insert(c);
    for (const role of Object.values(s.roles)) await r.roles.insert(role);
    for (const u of Object.values(s.users)) await r.users.insert(u);
    for (const l of Object.values(s.licenses)) await r.licenses.upsert(l);
    for (const name of ORDER) {
      let rows = Object.values(s.tenant[name]) as CompanyScoped[];
      // Corrected runs must exist before their corrections.
      if (name === "payrollRuns") rows = [...rows].sort((a, b) => Number(!!(a as PayrollRun).correctsRunId) - Number(!!(b as PayrollRun).correctsRunId));
      await (r[name] as unknown as { insertMany: (rows: CompanyScoped[]) => Promise<void> }).insertMany(rows);
    }
    for (const e of s.audit) await r.audit.append(e);
  });
}

let template: PGlite | null = null;

/** A database holding the full demo seed (converted for production), cloned per test. */
export async function seededDatabase() {
  if (!template) {
    const { pg, db } = await freshDatabase();
    const { state, blobs } = await seedState();
    const repo = new DatabaseRepository(db, { cipher: createFieldCipher(TEST_KEY) });
    await loadState(repo, state);
    const storage = new DatabaseDocumentStorage(db);
    for (const [k, v] of blobs) await storage.put(k, v, "application/pdf");
    template = pg;
  }
  const pg = (await template.clone()) as PGlite;
  const db = drizzle(pg) as unknown as Db;
  return { pg, db, repo: new DatabaseRepository(db, { cipher: createFieldCipher(TEST_KEY) }), storage: new DatabaseDocumentStorage(db) };
}
