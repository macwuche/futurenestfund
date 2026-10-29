import { defineConfig } from "drizzle-kit";
import path from "path";
import { resolveDatabase } from "./src/connection";

const database = resolveDatabase();

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  // Versioned migrations (drizzle-kit generate), applied by `pnpm --filter @workspace/scripts run db:migrate`.
  out: "./migrations", // relative: drizzle-kit mishandles absolute paths here
  dialect: "postgresql",
  dbCredentials: { url: database.url, ssl: database.ssl },
  // Only manage the app's demo_* tables. Supabase-side tables (user_roles, app_migrations) come from
  // lib/db/supabase/migrations and must never be dropped by a push.
  tablesFilter: ["demo_*"],
});
