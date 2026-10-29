import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { requireEnv, supabaseSsl } from "./supabaseEnv";

// Applies lib/db/supabase/migrations/*.sql to the Supabase project in name order, each exactly once.
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db/supabase/migrations");

const client = new pg.Client({ connectionString: requireEnv("SUPABASE_DB_URL"), ssl: supabaseSsl });
await client.connect();
try {
  await client.query(`create table if not exists public.app_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  await client.query("alter table public.app_migrations enable row level security");

  const applied = new Set((await client.query<{ name: string }>("select name from public.app_migrations")).rows.map((r) => r.name));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip    ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.app_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }
} finally {
  await client.end();
}
