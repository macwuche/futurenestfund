import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Card payments (Phase 13): physical cards customers collected at the office, saved by the customer so deposits can be
 * charged to them and withdrawals paid to them. A saved card waits for review (Pending) until an administrator approves
 * it (Active) or declines it (Declined); the customer is emailed at each step. Administrators also approve each deposit
 * and withdrawal made with it, can block a card, and keep a list of cards reported lost, stolen or expired
 * (`demo_reported_cards`).
 *
 * The card number and CVV are encrypted with the settings master key (lib/secretBox.ts, field-bound); only an
 * administrator's "Show card details" opens them, and every view is audited. `number_hash` (HMAC of the number with the
 * same key) finds the same card on other accounts and on the reported list without opening anything.
 */
export const demoPaymentCardsTable = pgTable("demo_payment_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: text("profile_id").notNull(),
  holderName: text("holder_name").notNull(),
  /** visa | mastercard | amex | verve | discover | other (from the number) */
  network: text("network").notNull(),
  lastFour: text("last_four").notNull(),
  numberHash: text("number_hash").notNull(),
  numberSealed: text("number_sealed").notNull(),
  cvvSealed: text("cvv_sealed").notNull(),
  expMonth: integer("exp_month").notNull(),
  expYear: integer("exp_year").notNull(),
  /** Pending (under review) | Active (approved) | Declined | Blocked | Removed (by the customer) */
  status: text("status").notNull().default("Pending"),
  /** Blocked: Lost | Stolen | Expired | Not our card | Other, and the note shown to the customer (also the decline reason). */
  blockReason: text("block_reason"),
  blockNote: text("block_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, t => [
  index("demo_payment_cards_profile").on(t.profileId),
  index("demo_payment_cards_hash").on(t.numberHash),
]).enableRLS();

export type DemoPaymentCard = typeof demoPaymentCardsTable.$inferSelect;

/**
 * Cards reported lost, stolen, expired or otherwise not to be used, kept by administrators (e.g. when a customer calls
 * the office). Saved cards with the same number are flagged and can't be used. Entries are cleared, never deleted.
 */
export const demoReportedCardsTable = pgTable("demo_reported_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  numberHash: text("number_hash").notNull(),
  network: text("network").notNull(),
  lastFour: text("last_four").notNull(),
  /** Lost | Stolen | Expired | Damaged | Other */
  reason: text("reason").notNull(),
  note: text("note").notNull().default(""),
  reportedBy: text("reported_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  clearedBy: text("cleared_by"),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
}, t => [index("demo_reported_cards_hash").on(t.numberHash)]).enableRLS();

export type DemoReportedCard = typeof demoReportedCardsTable.$inferSelect;
