import pg from "pg";
import { requireEnv, supabaseSsl } from "./supabaseEnv";

// Sets the app_api role's password from APP_DB_PASSWORD (run after db:migrate). The app then connects with
// SUPABASE_DB_URL=postgresql://app_api.<project-ref>:<APP_DB_PASSWORD>@<pooler-host>:5432/postgres
const password = requireEnv("APP_DB_PASSWORD");
if (password.length < 24) { console.error("APP_DB_PASSWORD must be at least 24 characters."); process.exit(1); }
const client = new pg.Client({ connectionString: requireEnv("SUPABASE_ADMIN_DB_URL"), ssl: supabaseSsl });
await client.connect();
try {
  await client.query(`alter role app_api with password ${client.escapeLiteral(password)}`);
  console.log("app_api password set");
} finally {
  await client.end();
}
