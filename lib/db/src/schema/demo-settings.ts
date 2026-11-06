import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const demoSettingsTable = pgTable("demo_settings", {
  id: text("id").primaryKey(),
  frozen: boolean("frozen").notNull().default(false),
  /** Before Step 9.4: the platform-wide withdrawal limits in cents. Replaced by the tier rules (migration 0012 copied them into every tier); unused. */
  withdrawalMaxCents: integer("withdrawal_max_cents"),
  withdrawalDailyCents: integer("withdrawal_daily_cents"),
  /** Eligible amount per tier in cents ("Largest open award at Tier N"); null = not set. A user's custom amount replaces it. */
  tier1EligibleCents: integer("tier1_eligible_cents"),
  tier2EligibleCents: integer("tier2_eligible_cents"),
  tier3EligibleCents: integer("tier3_eligible_cents"),
  /** Step 9.3: the card types users can buy, with a price and a fee per kind (see api-server lib/cardTypes.ts); null = none set up. */
  cardTypes: jsonb("card_types"),
  /** Step 9.4: per tier, withdrawal and card top-up limits, the card types it may buy and its upgrade form (see api-server lib/tierRules.ts). */
  tierRules: jsonb("tier_rules"),
  /** Branding (Admin Settings → Branding): { appName, color, logoFileId }; null = the defaults (see api-server lib/branding.ts). */
  branding: jsonb("branding"),
  /** Email settings made in Admin Settings (sender, reply-to, signature, support address); they win over the env vars. */
  emailConfig: jsonb("email_config"),
  /** Email secrets (Resend API key, Send Email Hook secret), each AES-256-GCM encrypted with SETTINGS_ENCRYPTION_KEY. */
  emailSecrets: jsonb("email_secrets"),
  /** When Supabase's Send Email Hook last called us, and how that call ended. */
  emailHookSeenAt: timestamp("email_hook_seen_at", { withTimezone: true }),
  emailHookResult: text("email_hook_result"),
}).enableRLS();

export const insertDemoSettingsSchema = createInsertSchema(demoSettingsTable);
