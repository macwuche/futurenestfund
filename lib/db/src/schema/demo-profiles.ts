import { pgTable, text, integer, jsonb, date, uuid, boolean } from "drizzle-orm/pg-core";
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
  /** Legacy sample KYC data; documents now live in demo_kyc_documents. */
  documents: jsonb("documents").notNull().default([]),
  permissions: jsonb("permissions").notNull(),
  joinedAt: date("joined_at", { mode: "string" }).notNull(),
  avatarFileId: uuid("avatar_file_id"),
  /** Supabase Auth user (auth.users.id) this profile belongs to; null for the seeded sample profiles. */
  authUserId: uuid("auth_user_id").unique(),
  /** When true, this user's withdrawal limits (cents, null = no limit) replace the global ones. */
  withdrawalLimitCustom: boolean("withdrawal_limit_custom").notNull().default(false),
  withdrawalMaxCents: integer("withdrawal_max_cents"),
  withdrawalDailyCents: integer("withdrawal_daily_cents"),
}).enableRLS();

export const insertDemoProfileSchema = createInsertSchema(demoProfilesTable);
export type DemoProfile = typeof demoProfilesTable.$inferSelect;
