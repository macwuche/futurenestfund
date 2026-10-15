import { pgTable, text, integer, jsonb, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Isolated sample data: never connect these records to real payment rails.
export const demoProfilesTable = pgTable("demo_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  organization: text("organization").notNull(),
  phone: text("phone").notNull().default(""),
  telegram: text("telegram").notNull().default(""),
  maskedId: text("masked_id").notNull(),
  tier: integer("tier").notNull().default(1),
  verificationLevel: text("verification_level").notNull().default("Pending"),
  status: text("status").notNull().default("Active"),
  grantCents: integer("grant_cents").notNull().default(0),
  depositCents: integer("deposit_cents").notNull().default(0),
  cardCents: integer("card_cents").notNull().default(0),
  cards: jsonb("cards").notNull().default([]),
  documents: jsonb("documents").notNull().default([]),
  permissions: jsonb("permissions").notNull(),
  joinedAt: date("joined_at", { mode: "string" }).notNull(),
}).enableRLS();

export const insertDemoProfileSchema = createInsertSchema(demoProfilesTable);
export type DemoProfile = typeof demoProfilesTable.$inferSelect;
