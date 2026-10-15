import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const demoAuditTable = pgTable("demo_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: text("profile_id"),
  action: text("action").notNull(),
  actor: text("actor").notNull().default("Demo administrator"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const demoLedgerTable = pgTable("demo_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: text("profile_id").notNull(),
  account: text("account").notNull(),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const insertDemoAuditSchema = createInsertSchema(demoAuditTable).omit({ id: true, createdAt: true });
export const insertDemoLedgerSchema = createInsertSchema(demoLedgerTable).omit({ id: true, createdAt: true });
