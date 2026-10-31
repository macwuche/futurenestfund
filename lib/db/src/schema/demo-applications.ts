import { pgTable, text, timestamp, uuid, integer, boolean, date, jsonb } from "drizzle-orm/pg-core";

// Applicant-owned records. Sample data only, isolated from any production grant system.
export const demoApplicationsTable = pgTable("demo_applications", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull().default("Submitted"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/** Append-only status history shown as the application timeline. */
export const demoApplicationEventsTable = pgTable("demo_application_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: text("application_id").notNull(),
  status: text("status").notNull(),
  note: text("note").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const demoMilestonesTable = pgTable("demo_milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: text("profile_id").notNull(),
  title: text("title").notNull(),
  grant: text("grant").notNull(),
  due: date("due", { mode: "string" }).notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const demoNotificationsTable = pgTable("demo_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: text("profile_id").notNull(),
  message: text("message").notNull(),
  link: text("link"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set once the notification email went out (see api-server notificationMailer). */
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  emailAttempts: integer("email_attempts").notNull().default(0),
  /** While set and in the future, a mailer has claimed this row and is sending it. */
  emailClaimedUntil: timestamp("email_claimed_until", { withTimezone: true }),
  /** Dedicated email template for this notification (e.g. "withdrawal_requested"); null uses the generic one. */
  emailKind: text("email_kind"),
  /** Values for that template (amount, reference, reason). */
  emailData: jsonb("email_data"),
  /** Why the last email attempt failed (scrubbed), shown in Admin Settings → Email health. */
  emailLastError: text("email_last_error"),
  /** False when an administrator turned in-app notifications off for the user: kept for the email, hidden from the bell. */
  inApp: boolean("in_app").notNull().default(true),
}).enableRLS();
