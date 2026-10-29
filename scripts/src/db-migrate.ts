import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolveDatabase } from "@workspace/db/connection";
import { supabaseSsl } from "./supabaseEnv";

/**
 * Applies database migrations, each exactly once:
 *  1. lib/db/migrations (drizzle-kit generate): the app's tables, on whichever database the app uses;
 *  2. lib/db/supabase/migrations: Supabase-only SQL (auth-linked roles, the app_api role and RLS policies), Supabase only.
 * Runs as the database owner: SUPABASE_ADMIN_DB_URL (the `postgres` user) for Supabase, otherwise the app's own URL.
 * `--baseline` records 0000_baseline as applied without running it, for a database whose tables were made by `db push`.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db");
const appDb = resolveDatabase();
const adminUrl = process.env.SUPABASE_ADMIN_DB_URL?.trim();
const target = adminUrl ? "supabase" : appDb.target;
if (target === "supabase" && !adminUrl) {
  console.error("Set SUPABASE_ADMIN_DB_URL (the postgres user's pooler URL) to migrate Supabase; the app's own role can't change the schema.");
  process.exit(1);
}
const client = new pg.Client({ connectionString: adminUrl ?? appDb.url, ssl: target === "supabase" ? supabaseSsl : undefined });
await client.connect();
try {
  const folder = path.join(root, "migrations");
  if (process.argv.includes("--baseline")) {
    const journal = JSON.parse(await readFile(path.join(folder, "meta/_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const first = journal.entries[0]!;
    await client.query("create schema if not exists drizzle");
    await client.query("create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)");
    const { rows } = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    const exists = (await client.query("select to_regclass('public.demo_profiles') is not null as ok")).rows[0].ok;
    if (rows[0].n > 0) console.log("baseline: migrations already recorded, nothing to do");
    else if (!exists) throw new Error("baseline: the app tables don't exist here; run without --baseline to create them");
    else {
      // Same hash drizzle's migrator computes (sha256 of the whole file), so it treats 0000 as applied.
      const hash = createHash("sha256").update(await readFile(path.join(folder, `${first.tag}.sql`), "utf8")).digest("hex");
      await client.query("insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)", [hash, first.when]);
      console.log(`baseline: recorded ${first.tag} as applied`);
    }
  }
  const before = Number((await client.query("select count(*) from drizzle.__drizzle_migrations").catch(() => ({ rows: [{ count: 0 }] }))).rows[0].count);
  await migrate(drizzle(client), { migrationsFolder: folder });
  const after = Number((await client.query("select count(*) from drizzle.__drizzle_migrations")).rows[0].count);
  console.log(`app migrations: ${after - before} applied, ${after} recorded`);

  if (target === "supabase") {
    const dir = path.join(root, "supabase/migrations");
    await client.query("create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now())");
    await client.query("alter table public.app_migrations enable row level security");
    const applied = new Set((await client.query<{ name: string }>("select name from public.app_migrations")).rows.map((r) => r.name));
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      if (applied.has(file)) { console.log(`supabase: skip    ${file}`); continue; }
      await client.query("begin");
      try {
        await client.query(await readFile(path.join(dir, file), "utf8"));
        await client.query("insert into public.app_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`supabase: applied ${file}`);
      } catch (err) { await client.query("rollback"); throw err; }
    }
  }
} finally {
  await client.end();
}
