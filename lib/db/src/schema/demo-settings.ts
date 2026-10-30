import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const demoSettingsTable = pgTable("demo_settings", {
  id: text("id").primaryKey(),
  frozen: boolean("frozen").notNull().default(false),
  /** Global withdrawal limits in cents; null = no limit. A user's custom limits replace these. */
  withdrawalMaxCents: integer("withdrawal_max_cents"),
  withdrawalDailyCents: integer("withdrawal_daily_cents"),
}).enableRLS();

export const insertDemoSettingsSchema = createInsertSchema(demoSettingsTable);
