/**
 * Demo persistence adapter. Components never touch IndexedDB or localStorage
 * directly — they go through the repository, which uses this adapter.
 * Falls back to memory when IndexedDB is unavailable (private mode, tests).
 */
export interface DemoStorage {
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = "hr-payroll-suite-demo";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbStorage implements DemoStorage {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = openDb();
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async load<T>(key: string) {
    return ((await this.tx("readonly", (s) => s.get(key))) as T | undefined) ?? null;
  }
  async save<T>(key: string, value: T) {
    await this.tx("readwrite", (s) => s.put(value, key));
  }
  async remove(key: string) {
    await this.tx("readwrite", (s) => s.delete(key));
  }
  async clear() {
    await this.tx("readwrite", (s) => s.clear());
  }
}

export class MemoryStorage implements DemoStorage {
  private map = new Map<string, unknown>();
  async load<T>(key: string) {
    return (this.map.has(key) ? structuredClone(this.map.get(key)) : null) as T | null;
  }
  async save<T>(key: string, value: T) {
    this.map.set(key, structuredClone(value));
  }
  async remove(key: string) {
    this.map.delete(key);
  }
  async clear() {
    this.map.clear();
  }
}

export async function createDemoStorage(): Promise<DemoStorage> {
  if (typeof indexedDB === "undefined") return new MemoryStorage();
  try {
    const s = new IndexedDbStorage();
    await s.load("__probe__");
    return s;
  } catch {
    return new MemoryStorage();
  }
}
