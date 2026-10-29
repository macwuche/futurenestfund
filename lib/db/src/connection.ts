/**
 * Which Postgres the app uses: the dedicated Supabase project when SUPABASE_DB_URL is set,
 * otherwise the Replit Postgres fallback (DATABASE_URL). Shared by the app and drizzle-kit.
 */
export function resolveDatabase(): { target: "supabase" | "replit"; url: string; ssl: false | { rejectUnauthorized: boolean } } {
  const supabaseUrl = process.env.SUPABASE_DB_URL?.trim();
  if (supabaseUrl) {
    // Supabase's pooler certificate isn't in Node's default CA bundle; the connection is still TLS-encrypted.
    return { target: "supabase", url: supabaseUrl, ssl: { rejectUnauthorized: false } };
  }
  const replitUrl = process.env.DATABASE_URL?.trim();
  if (replitUrl) return { target: "replit", url: replitUrl, ssl: false };
  throw new Error("Set SUPABASE_DB_URL (Supabase) or DATABASE_URL (Replit Postgres fallback).");
}
