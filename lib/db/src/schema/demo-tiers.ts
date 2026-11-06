import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Step 9.4: a user's request to move up one tier, made by filling in the upgrade form the administrator built for that
 * tier. An administrator approves (the tier goes up) or declines it with a reason (the user can ask again).
 * The form is copied into `form_snapshot`, so editing it never changes requests already made.
 */
export const demoTierRequestsTable = pgTable("demo_tier_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: text("profile_id").notNull(),
  fromTier: integer("from_tier").notNull(),
  toTier: integer("to_tier").notNull(),
  /** Pending | Approved | Declined */
  status: text("status").notNull().default("Pending"),
  /** The upgrade form as it was when submitted: { intro, fields }. */
  formSnapshot: jsonb("form_snapshot").notNull(),
  /** Answers by field id; a file field holds the id of the uploaded file (demo_files, purpose "tier"). */
  answers: jsonb("answers").notNull().default({}),
  decisionNote: text("decision_note"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  // One open request per user, even when two arrive at once.
  uniqueIndex("demo_tier_requests_one_pending").on(t.profileId).where(sql`status = 'Pending'`),
]).enableRLS();

export type DemoTierRequest = typeof demoTierRequestsTable.$inferSelect;
