import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const demoSettingsTable = pgTable("demo_settings", {
  id: text("id").primaryKey(),
  frozen: boolean("frozen").notNull().default(false),
  /** Global withdrawal limits in cents; null = no limit. A user's custom limits replace these. */
  withdrawalMaxCents: integer("withdrawal_max_cents"),
  withdrawalDailyCents: integer("withdrawal_daily_cents"),
  /** Eligible amount per tier in cents ("Largest open award at Tier N"); null = not set. A user's custom amount replaces it. */
  tier1EligibleCents: integer("tier1_eligible_cents"),
  tier2EligibleCents: integer("tier2_eligible_cents"),
  tier3EligibleCents: integer("tier3_eligible_cents"),
  /** Email settings made in Admin Settings (sender, reply-to, signature, support address); they win over the env vars. */
  emailConfig: jsonb("email_config"),
  /** Email secrets (Resend API key, Send Email Hook secret), each AES-256-GCM encrypted with SETTINGS_ENCRYPTION_KEY. */
  emailSecrets: jsonb("email_secrets"),
  /** When Supabase's Send Email Hook last called us, and how that call ended. */
  emailHookSeenAt: timestamp("email_hook_seen_at", { withTimezone: true }),
  emailHookResult: text("email_hook_result"),
}).enableRLS();

export const insertDemoSettingsSchema = createInsertSchema(demoSettingsTable);
