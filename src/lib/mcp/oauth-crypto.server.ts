import "server-only";
import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Generate an unpredictable opaque credential or PKCE verifier without embedded identity.
export function newOpaqueToken() { return randomBytes(32).toString("base64url"); }
// Hash credentials before persistence and reuse this digest for non-secret rate-limit keys.
export function hashToken(value: string) { return createHash("sha256").update(value).digest("hex"); }
// Derive only the S256 PKCE challenge accepted by this bridge.
export function pkceChallenge(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }
// Compare fixed-format hashes without data-dependent early exits.
export function equalHash(first: string, second: string) { return /^[a-f0-9]{64}$/.test(first) && /^[a-f0-9]{64}$/.test(second) && timingSafeEqual(Buffer.from(first, "hex"), Buffer.from(second, "hex")); }
// Encrypt upstream credentials using the pending/grant identity as authenticated associated data.
export function encryptCustody(key: Buffer, id: string, value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(id));
  const text = JSON.stringify(value);
  if (text.length > 24000) throw new Error("Credential custody unavailable.");
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}
// Decrypt only with the exact persisted record identity; corruption fails closed.
export function decryptCustody(key: Buffer, id: string, value: string): unknown {
  if (value.length > 40000) throw new Error("Credential custody unavailable.");
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Credential custody unavailable.");
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64url"));
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Credential custody unavailable.");
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString("utf8"));
}
