import { SUPABASE_ROOT_CA } from "./supabaseCa";

/**
 * Which Postgres the app uses: the dedicated Supabase project when SUPABASE_DB_URL is set,
 * otherwise the Replit Postgres fallback (DATABASE_URL). Shared by the app and drizzle-kit.
 */
export function resolveDatabase(): { target: "supabase" | "replit"; url: string; ssl: false | { ca: string; rejectUnauthorized: true } } {
  const supabaseUrl = process.env.SUPABASE_DB_URL?.trim();
  if (supabaseUrl) {
    // Supabase's certificates chain to its own root, which isn't in Node's bundle: pin it and verify the server.
    return { target: "supabase", url: supabaseUrl, ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true } };
  }
  const replitUrl = process.env.DATABASE_URL?.trim();
  if (replitUrl) return { target: "replit", url: replitUrl, ssl: false };
  throw new Error("Set SUPABASE_DB_URL (Supabase) or DATABASE_URL (Replit Postgres fallback).");
}
