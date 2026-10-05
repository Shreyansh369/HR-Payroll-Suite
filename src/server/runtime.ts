/**
 * Production runtime wiring: database connection, repository and document storage.
 * Connections are cached on globalThis so development hot reloads reuse them.
 */
import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { DatabaseDocumentStorage, DatabaseRepository, type Db } from "@/repositories/database/database-repository";
import type { DocumentStorage, Repository } from "@/repositories/interfaces";
import { createFieldCipher, type FieldCipher } from "@/server/crypto";
import { assertProductionReady } from "@/server/env";

type Runtime = { db: Db; sql: postgres.Sql; cipher: FieldCipher; repo: Repository; storage: DocumentStorage };

const globalForRuntime = globalThis as unknown as { __hpsRuntime?: Runtime };

/** Files on a local or mounted volume. Keys are content-addressed ids; never user input. */
export class LocalDiskStorage implements DocumentStorage {
  constructor(private readonly root: string) {}
  private file(key: string) {
    if (!/^[\w./-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key.");
    return path.join(this.root, key);
  }
  async put(key: string, bytes: Uint8Array) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, bytes, { mode: 0o600 });
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.file(key)));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

export function runtime(): Runtime {
  if (globalForRuntime.__hpsRuntime) return globalForRuntime.__hpsRuntime;
  const env = assertProductionReady();
  const sql = postgres(env.DATABASE_URL, { max: env.DATABASE_POOL_SIZE, prepare: true, onnotice: () => {} });
  const db = drizzle(sql) as unknown as Db;
  const cipher = createFieldCipher(env.DATA_ENCRYPTION_KEY);
  const repo = new DatabaseRepository(db, { cipher });
  const storage = env.STORAGE_DRIVER === "local" ? new LocalDiskStorage(path.resolve(env.STORAGE_DIR)) : new DatabaseDocumentStorage(db);
  globalForRuntime.__hpsRuntime = { db, sql, cipher, repo, storage };
  return globalForRuntime.__hpsRuntime;
}
