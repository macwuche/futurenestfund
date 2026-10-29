import { SUPABASE_ROOT_CA } from "@workspace/db/supabase-ca";

/** Reads a required environment variable, failing with a clear message (never printing secret values). */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing environment variable ${name}. Add it to Replit Secrets (see work.md §9).`);
    process.exit(1);
  }
  return value;
}

/** Verify Supabase's certificate against its pinned root CA (see lib/db/src/supabaseCa.ts). */
export const supabaseSsl = { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };
