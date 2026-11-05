import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Phase 11: industries an administrator manages (add / rename / remove). Users pick one; grant plans belong to one. */
export const demoIndustriesTable = pgTable("demo_industries", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type DemoIndustry = typeof demoIndustriesTable.$inferSelect;

/**
 * Phase 11: grant plans an administrator creates. Applicants apply to an enabled plan through the plan's own form.
 * Applications copy the plan into `demo_applications.plan_snapshot`, so editing a plan never changes them.
 * A plan that has applications is never deleted, only switched off.
 */
export const demoGrantPlansTable = pgTable("demo_grant_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** null = all industries. */
  industryId: uuid("industry_id"),
  amountCents: integer("amount_cents").notNull(),
  /** The application fee, charged on approval. fixed: fee_value in cents; percent: hundredths of a percent of the award (1% = 100). */
  feeMode: text("fee_mode").notNull().default("fixed"),
  feeValue: integer("fee_value").notNull().default(0),
  logoFileId: uuid("logo_file_id"),
  /** The application form: the administrator's fields (see lib/grantPlans.ts). */
  fields: jsonb("fields").notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type DemoGrantPlan = typeof demoGrantPlansTable.$inferSelect;
