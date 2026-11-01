import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Encryption for secrets stored in the database (the Resend API key and the Send Email Hook secret set in Admin Settings).
 * AES-256-GCM with a master key that never goes into the database, so a database dump or backup alone doesn't reveal
 * the secrets. The field name is bound in as associated data: a value sealed for one field can't be copied into another.
 *
 * Where the master key comes from (32 random bytes, base64):
 *   1. SETTINGS_ENCRYPTION_KEY in the server environment, when set;
 *   2. otherwise a key file the server creates by itself the first time it's needed (mode 0600), so an administrator can
 *      save the Resend key from Admin Settings with nothing to do on the server. Its place is SETTINGS_KEY_FILE, or
 *      `settings.key` next to (not inside) the uploads folder: on the VPS /var/lib/futurenestfund/settings.key, which
 *      survives deploys and isn't in the nightly backup. Losing it means entering the saved secrets again.
 *
 * Format: `v1:<iv>:<tag>:<ciphertext>`, each part base64.
 */

export class SecretBoxError extends Error {}

/** Checks a base64 master key: the key, or null with the reason. */
export function parseKey(raw: string | undefined, from = "SETTINGS_ENCRYPTION_KEY"): { key: Buffer | null; problem: string | null } {
  const v = raw?.trim();
  if (!v) return { key: null, problem: `${from} is empty.` };
  const key = /^[A-Za-z0-9+/=_-]+$/.test(v) ? Buffer.from(v, "base64") : Buffer.alloc(0);
  if (key.length !== 32) return { key: null, problem: `${from} must be 32 random bytes in base64 (openssl rand -base64 32).` };
  return { key, problem: null };
}

export function keyFilePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env["SETTINGS_KEY_FILE"]?.trim()) return path.resolve(env["SETTINGS_KEY_FILE"].trim());
  const uploads = path.resolve(env["UPLOAD_DIR"] ?? path.join(process.cwd(), "uploads"));
  return path.join(path.dirname(uploads), "settings.key");
}

/** Reads the key file, creating it with a fresh random key when it doesn't exist yet (`wx`: never overwrites one). */
export function keyFromFile(file: string): { key: Buffer | null; problem: string | null } {
  try {
    writeFileSync(file, randomBytes(32).toString("base64") + "\n", { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      return { key: null, problem: `The server couldn't create its encryption key file (${file}): ${(err as Error).message}. Set SETTINGS_ENCRYPTION_KEY in its environment instead.` };
    }
  }
  try {
    return parseKey(readFileSync(file, "utf8"), `The key file ${file}`);
  } catch (err) {
    return { key: null, problem: `The server couldn't read its encryption key file (${file}): ${(err as Error).message}.` };
  }
}

let cached: { key: Buffer | null; problem: string | null } | null = null;

/** The master key in use (environment first, then the key file), or null with the reason. A working key is cached. */
export function masterKey(): { key: Buffer | null; problem: string | null } {
  if (cached) return cached;
  const env = process.env["SETTINGS_ENCRYPTION_KEY"];
  const result = env?.trim() ? parseKey(env) : keyFromFile(keyFilePath());
  if (result.key) cached = result;
  return result;
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
    throw new SecretBoxError("The secret can't be decrypted (the server's encryption key changed, or the value was changed).");
  }
}
