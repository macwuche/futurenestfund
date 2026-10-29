import pg from "pg";
import { requireEnv, supabaseSsl } from "./supabaseEnv";

// Creates (or repairs) the first administrator in Supabase Auth and records the role.
// Safe to re-run: an existing account keeps its password unless --reset-password is passed.
const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
const secretKey = requireEnv("SUPABASE_SECRET_KEY");
const email = requireEnv("ADMIN_SEED_EMAIL").toLowerCase();
const password = requireEnv("ADMIN_SEED_PASSWORD");
const resetPassword = process.argv.includes("--reset-password");
const role = "admin";

type AuthUser = { id: string; email?: string; email_confirmed_at?: string | null; app_metadata?: Record<string, unknown> };

async function authAdmin<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/${route}`, {
    method,
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase Auth ${method} ${route} failed (${res.status}): ${text}`);
  return JSON.parse(text) as T;
}

async function findUserByEmail(): Promise<AuthUser | undefined> {
  for (let page = 1; ; page++) {
    const { users } = await authAdmin<{ users: AuthUser[] }>("GET", `users?page=${page}&per_page=200`);
    const match = users.find((u) => u.email?.toLowerCase() === email);
    if (match || users.length < 200) return match;
  }
}

let user = await findUserByEmail();
if (!user) {
  user = await authAdmin<AuthUser>("POST", "users", {
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { name: "Administrator" },
  });
  console.log(`created admin ${email} (${user.id})`);
} else {
  const changes: Record<string, unknown> = {};
  if (user.app_metadata?.role !== role) changes.app_metadata = { ...user.app_metadata, role };
  if (!user.email_confirmed_at) changes.email_confirm = true;
  if (resetPassword) changes.password = password;
  if (Object.keys(changes).length) {
    user = await authAdmin<AuthUser>("PUT", `users/${user.id}`, changes);
    console.log(`updated admin ${email} (${user.id}): ${Object.keys(changes).join(", ")}`);
  } else {
    console.log(`admin ${email} already exists (${user.id}); auth record unchanged`);
  }
}

const client = new pg.Client({ connectionString: requireEnv("SUPABASE_DB_URL"), ssl: supabaseSsl });
await client.connect();
try {
  const { rowCount } = await client.query(
    `insert into public.user_roles (user_id, role) values ($1, $2)
     on conflict (user_id) do update set role = excluded.role, updated_at = now()
     where public.user_roles.role is distinct from excluded.role`,
    [user.id, role],
  );
  console.log(rowCount ? `user_roles: ${email} → ${role}` : "user_roles: already up to date");
} finally {
  await client.end();
}
