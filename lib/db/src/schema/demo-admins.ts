import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Administrators' own profile details (applicants live in demo_profiles). One row per admin sign-in:
 * `id` is `adm-<Supabase auth user id>`, or `adm-demo` for the shared demo administrator.
 */
export const demoAdminProfilesTable = pgTable("demo_admin_profiles", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  avatarFileId: uuid("avatar_file_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type DemoAdminProfile = typeof demoAdminProfilesTable.$inferSelect;
