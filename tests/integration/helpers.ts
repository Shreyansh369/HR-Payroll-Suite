import { buildDemoSeed } from "@/repositories/demo/seed";
import { InMemoryRepository, MemoryDocumentStorage, type RepositoryState } from "@/repositories/memory/memory-repository";
import { resolveActor } from "@/services/authz";
import { execute, type Ctx } from "@/services/core";
import { demoEntitlements } from "@/services/entitlements";
import { procedures, type ProcedureName, type ProcInput, type ProcOutput } from "@/services/registry";
import { randomId } from "@/lib/ids";

export const TODAY = "2026-10-05";

let cached: { state: RepositoryState; blobs: Map<string, Uint8Array> } | null = null;

export async function seededRepo() {
  if (!cached) cached = await buildDemoSeed(TODAY);
  const repo = new InMemoryRepository(structuredClone(cached.state));
  const storage = new MemoryDocumentStorage();
  for (const [k, v] of cached.blobs) await storage.put(k, v);
  return { repo, storage };
}

export async function as(repo: InMemoryRepository, storage: MemoryDocumentStorage, email: string, companyCode = "HHL") {
  const user = await repo.users.getByEmail(email);
  if (!user) throw new Error(`no user ${email}`);
  const companies = await repo.companies.listByOrganization(user.organizationId);
  const company = companies.find((c) => c.branding.shortName === companyCode)!;
  const actor = await resolveActor(repo, user.id, company.id);
  const ctx: Ctx = { actor, repo, storage, mode: "demo", entitlements: demoEntitlements(), now: () => new Date(`${TODAY}T12:00:00.000Z`), ids: (p) => randomId(p) };
  return {
    ctx,
    company,
    call: <N extends ProcedureName>(name: N, input: ProcInput<N>) => execute(procedures[name] as never, ctx, input) as Promise<ProcOutput<N>>,
  };
}
