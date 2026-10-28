import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const demoAuditTable = pgTable("demo_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: text("profile_id"),
  action: text("action").notNull(),
  actor: text("actor").notNull().default("Demo administrator"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * Every money movement. Signed amounts (negative = money out). Rows link to the request or application
 * that caused them; like the audit log, the table is append-only (enforced by a trigger at boot).
 */
export const demoLedgerTable = pgTable("demo_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: text("profile_id").notNull(),
  kind: text("kind").notNull().default("Top-up"), // Top-up | Deposit | Withdrawal | Grant award | Opening balance
  account: text("account").notNull(),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  requestId: uuid("request_id"),
  applicationId: text("application_id"),
  actor: text("actor").notNull().default("Demo administrator"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const insertDemoAuditSchema = createInsertSchema(demoAuditTable).omit({ id: true, createdAt: true });
export const insertDemoLedgerSchema = createInsertSchema(demoLedgerTable).omit({ id: true, createdAt: true });
