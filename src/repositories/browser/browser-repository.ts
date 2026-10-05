/**
 * Demo repository: the in-memory repository with debounced persistence to a
 * DemoStorage adapter, plus a matching document byte store.
 */
import { InMemoryRepository, STATE_VERSION, type RepositoryState } from "@/repositories/memory/memory-repository";
import type { DocumentStorage } from "@/repositories/interfaces";
import type { DemoStorage } from "@/repositories/browser/demo-storage";

export const STATE_KEY = `demo-state-v${STATE_VERSION}`;
const BLOB_PREFIX = "blob:";

export class BrowserRepository extends InMemoryRepository {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: RepositoryState | null = null;

  constructor(
    state: RepositoryState,
    private readonly storage: DemoStorage,
  ) {
    super(state, { onChange: (s) => this.schedule(s) });
  }

  private schedule(state: RepositoryState) {
    this.pending = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 150);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.pending;
    this.pending = null;
    if (s) await this.storage.save(STATE_KEY, s);
  }
}

export class BrowserDocumentStorage implements DocumentStorage {
  constructor(private readonly storage: DemoStorage) {}
  async put(key: string, bytes: Uint8Array) {
    await this.storage.save(BLOB_PREFIX + key, bytes);
  }
  async get(key: string) {
    const v = await this.storage.load<Uint8Array>(BLOB_PREFIX + key);
    return v ? new Uint8Array(v) : null;
  }
  async delete(key: string) {
    await this.storage.remove(BLOB_PREFIX + key);
  }
}
