import { pgTable, text, timestamp, uuid, integer, boolean, real } from "drizzle-orm/pg-core";

/**
 * Metadata for files stored on the API server's disk (never Supabase Storage).
 * `storedName` is a server-generated name inside the upload directory; the original name is display-only.
 */
export const demoFilesTable = pgTable("demo_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: text("profile_id").notNull(),
  purpose: text("purpose").notNull(), // avatar | kyc | proposal
  applicationId: text("application_id"),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  storedName: text("stored_name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * Identity documents. The newest non-superseded row per (profile, kind) is the current one;
 * replaced rows are kept for the audit trail. Sample rows have no file and carry a demo OCR score.
 */
export const demoKycDocumentsTable = pgTable("demo_kyc_documents", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  kind: text("kind").notNull(), // Government ID | Proof of address
  name: text("name").notNull(),
  status: text("status").notNull().default("Pending"), // Pending | Verified | Rejected
  fileId: uuid("file_id"),
  sampleConfidence: real("sample_confidence"),
  superseded: boolean("superseded").notNull().default(false),
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
