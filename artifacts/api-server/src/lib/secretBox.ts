import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for secrets stored in the database (the Resend API key and the Send Email Hook secret set in Admin Settings).
 * AES-256-GCM with a master key that only lives in the server environment, SETTINGS_ENCRYPTION_KEY (32 random bytes,
 * base64: `openssl rand -base64 32`), so a database dump or backup alone doesn't reveal the secrets. The field name is
 * bound in as associated data: a value sealed for one field can't be copied into another.
 *
 * Format: `v1:<iv>:<tag>:<ciphertext>`, each part base64.
 */

export class SecretBoxError extends Error {}

/** The master key, or null (with the reason) when it's missing or not 32 bytes. */
export function masterKey(raw = process.env.SETTINGS_ENCRYPTION_KEY): { key: Buffer | null; problem: string | null } {
  const v = raw?.trim();
  if (!v) return { key: null, problem: "SETTINGS_ENCRYPTION_KEY is not set on the server." };
  const key = /^[A-Za-z0-9+/=_-]+$/.test(v) ? Buffer.from(v, "base64") : Buffer.alloc(0);
  if (key.length !== 32) return { key: null, problem: "SETTINGS_ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32)." };
  return { key, problem: null };
}

export function seal(plain: string, field: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(field, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** Throws SecretBoxError when the value was tampered with, sealed for another field, or sealed with another master key. */
export function open(sealed: string, field: string, key: Buffer): string {
  const [v, iv, tag, ct] = sealed.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new SecretBoxError("Unknown secret format.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(field, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError("The secret can't be decrypted (wrong SETTINGS_ENCRYPTION_KEY, or the value was changed).");
  }
}
