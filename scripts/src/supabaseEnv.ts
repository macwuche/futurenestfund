/** Reads a required environment variable, failing with a clear message (never printing secret values). */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing environment variable ${name}. Add it to Replit Secrets (see work.md §9).`);
    process.exit(1);
  }
  return value;
}

/** Supabase's pooler certificate isn't in Node's default CA bundle; the connection is still TLS-encrypted. */
export const supabaseSsl = { rejectUnauthorized: false };
