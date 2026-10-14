/**
 * token-crypto.ts — envelope encryption for third-party OAuth tokens at rest.
 *
 * AES-256-GCM via the Web Crypto API (works in Node and Cloudflare Workers).
 * Key comes from the CALENDAR_TOKEN_KEY env var (64 hex chars = 32 bytes).
 * Set it in Cloudflare Pages env vars; never commit it.
 *
 * Stored format: "v1:" + base64(iv[12] || ciphertext). The version prefix
 * lets future rotations detect the scheme; rows without the prefix are
 * treated as legacy plaintext (there should be none — calendar OAuth was
 * never live before encryption landed).
 *
 * Decrypt pattern for the future calendar sync engine:
 *   const refreshToken = await decryptToken(row.refresh_token_enc);
 */

const PREFIX = "v1:";
const KEY_ENV = "CALENDAR_TOKEN_KEY";

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`${KEY_ENV} must be 64 hex characters (32 bytes)`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function importKey(): Promise<CryptoKey> {
  const hex = process.env[KEY_ENV];
  if (!hex) throw new Error(`${KEY_ENV} is not configured`);
  return crypto.subtle.importKey("raw", hexToBytes(hex), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Encrypt a plaintext token for storage. Throws if the key is missing. */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const combined = new Uint8Array(12 + ct.length);
  combined.set(iv);
  combined.set(ct, 12);
  return PREFIX + bytesToBase64(combined);
}

/**
 * Decrypt a stored token. Throws on legacy plaintext rows (caller should
 * treat as a data problem, never silently accept).
 */
export async function decryptToken(stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) {
    throw new Error("stored token is not encrypted (legacy plaintext row)");
  }
  const key = await importKey();
  const combined = base64ToBytes(stored.slice(PREFIX.length));
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/** True when the stored value carries the encryption prefix. */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
