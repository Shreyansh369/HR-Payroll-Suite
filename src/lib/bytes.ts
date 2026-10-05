/** Isomorphic byte helpers (browser + Node 20+). */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64DecodedLength(b64: string): number {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const ALLOWED_DOCUMENT_TYPES: Record<string, { label: string; ext: string[] }> = {
  "application/pdf": { label: "PDF", ext: ["pdf"] },
  "image/png": { label: "PNG image", ext: ["png"] },
  "image/jpeg": { label: "JPEG image", ext: ["jpg", "jpeg"] },
  "image/webp": { label: "WebP image", ext: ["webp"] },
  "text/plain": { label: "Text", ext: ["txt"] },
  "text/csv": { label: "CSV", ext: ["csv"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "Word document", ext: ["docx"] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { label: "Excel workbook", ext: ["xlsx"] },
};

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);

/**
 * Verify that file content matches its declared type, rejecting executables and
 * mismatched content regardless of the file name.
 */
export function sniffMatches(mimeType: string, bytes: Uint8Array): boolean {
  if (bytes.length < 4) return mimeType === "text/plain" || mimeType === "text/csv";
  // Reject Windows/ELF/Mach-O executables and scripts outright.
  if (startsWith(bytes, [0x4d, 0x5a]) || startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) || startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe])) return false;
  switch (mimeType) {
    case "application/pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case "text/plain":
    case "text/csv": {
      const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
      if (sample.includes(0)) return false;
      const head = new TextDecoder().decode(sample.subarray(0, 64)).trimStart().toLowerCase();
      return !head.startsWith("<script") && !head.startsWith("<!doctype html") && !head.startsWith("<html") && !head.startsWith("#!");
    }
    default:
      return false;
  }
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(-120) || "file";
}
