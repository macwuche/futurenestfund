import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Deposit and withdrawal methods an administrator creates in Payment Gateway (Phase 10).
 * Requests copy the method into `demo_requests.method_snapshot`, so editing a method never changes old requests.
 * A method that has requests is never deleted, only disabled.
 */
export const demoPaymentMethodsTable = pgTable("demo_payment_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // Deposit | Withdrawal
  name: text("name").notNull(),
  logoFileId: uuid("logo_file_id"),
  /** range: min_cents..max_cents (either may be null = no bound); fixed: the applicant picks one of fixed_amounts_cents. */
  amountMode: text("amount_mode").notNull().default("range"),
  minCents: integer("min_cents"),
  maxCents: integer("max_cents"),
  fixedAmountsCents: jsonb("fixed_amounts_cents").notNull().default([]),
  /** The administrator's extra fields the applicant fills in (see lib/paymentMethods.ts). */
  fields: jsonb("fields").notNull().default([]),
  /** Deposits only: required | optional | off. Withdrawals are always off. */
  proofMode: text("proof_mode").notNull().default("off"),
  instructions: text("instructions").notNull().default(""),
  /** Step 9.3: the method's fee. fixed: fee_value in cents; percent: fee_value in hundredths of a percent (1% = 100). */
  feeMode: text("fee_mode").notNull().default("fixed"),
  feeValue: integer("fee_value").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type DemoPaymentMethod = typeof demoPaymentMethodsTable.$inferSelect;
