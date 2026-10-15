import { boolean, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const demoSettingsTable = pgTable("demo_settings", {
  id: text("id").primaryKey(),
  frozen: boolean("frozen").notNull().default(false),
}).enableRLS();

export const insertDemoSettingsSchema = createInsertSchema(demoSettingsTable);
