/** Prefixed, URL-safe random identifiers ("emp_3k9f…"). */
export type IdPrefix =
  | "org"
  | "co"
  | "usr"
  | "role"
  | "dept"
  | "emp"
  | "evt"
  | "rate"
  | "sch"
  | "item"
  | "loan"
  | "lvt"
  | "lvp"
  | "lvl"
  | "lvr"
  | "ts"
  | "atc"
  | "doc"
  | "wf"
  | "task"
  | "run"
  | "inp"
  | "res"
  | "rule"
  | "imp"
  | "aud"
  | "lic"
  | "note"
  | "ses";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function randomId(prefix: IdPrefix, length = 16): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export type IdGenerator = (prefix: IdPrefix) => string;

/** Deterministic generator for seeds and tests. */
export function sequentialIds(seed = "s"): IdGenerator {
  const counters = new Map<string, number>();
  return (prefix) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_${seed}${String(n).padStart(4, "0")}`;
  };
}
