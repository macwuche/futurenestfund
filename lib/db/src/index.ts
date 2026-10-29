import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabase } from "./connection";

const { Pool } = pg;

export const database = resolveDatabase();

// The Supabase session pooler caps clients per project, so keep the pool small there.
export const pool = new Pool({ connectionString: database.url, ssl: database.ssl, max: database.target === "supabase" ? 5 : 10 });
export const db = drizzle(pool, { schema });

export * from "./schema";
