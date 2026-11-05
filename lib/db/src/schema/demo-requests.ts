import { jsonb, pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
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
  /** Withdrawals: which balance pays it (grant | deposit). Null for deposits. */
  source: text("source"),
  /** The payment method chosen (Phase 10); null for requests placed before methods existed. */
  methodId: uuid("method_id"),
  /** The method as it was when the request was placed: { name, logoFileId, fields: [{ id, label, type }] }. */
  methodSnapshot: jsonb("method_snapshot"),
  /** The applicant's answers to the method's fields, by field id. */
  fieldValues: jsonb("field_values"),
  /** Payment proof (deposits), in demo_files. */
  proofFileId: uuid("proof_file_id"),
  /** Step 9.3: the method's fee as worked out when the request was placed. Withdrawals: paid from the deposit (main) balance; deposits: taken out of the amount. */
  feeCents: integer("fee_cents").notNull().default(0),
}).enableRLS();

export const insertDemoRequestSchema = createInsertSchema(demoRequestsTable).omit({ id: true, createdAt: true, status: true });
