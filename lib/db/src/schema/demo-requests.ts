import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Applicant deposit/withdrawal requests. Sample data only: no money moves until an administrator acts on them.
export const demoRequestsTable = pgTable("demo_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: text("profile_id").notNull(),
  kind: text("kind").notNull(),
  amountCents: integer("amount_cents").notNull(),
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("Pending"), // Pending | Completed | Declined
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const insertDemoRequestSchema = createInsertSchema(demoRequestsTable).omit({ id: true, createdAt: true, status: true });
