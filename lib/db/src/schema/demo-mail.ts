import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * The admin Mail box (Phase 14, email.md). Mail is sent and received through Resend on the domain set in
 * Admin → Settings → Email; every message, in or out, is copied here (Resend's own copies and attachment links expire).
 *
 * - A mailbox is an address on that domain (e.g. support@futurenestfund.org). Every administrator sees every mailbox.
 *   One mailbox can be the catch-all (mail to addresses nobody created) and one the sender of system emails.
 * - A thread groups a conversation inside one mailbox (by In-Reply-To / References, else by subject and people).
 * - Trash and Spam are emptied 30 days after a thread was moved there.
 */
export const demoMailMailboxesTable = pgTable("demo_mail_mailboxes", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Lower case, on the configured domain. */
  address: text("address").notNull(),
  displayName: text("display_name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  catchAll: boolean("catch_all").notNull().default(false),
  /** System emails (notifications, money, tiers) are sent from, and replied to, this mailbox, with its signature. */
  systemSender: boolean("system_sender").notNull().default(false),
  /** The mailbox's signature: { enabled, name, title, organisation, phone, website, email, links[], color, logoFileId, footer, layout }. */
  signature: jsonb("signature"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("demo_mail_mailboxes_address").on(t.address)]).enableRLS();

export const demoMailThreadsTable = pgTable("demo_mail_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  mailboxId: uuid("mailbox_id").notNull(),
  subject: text("subject").notNull().default(""),
  /** inbox | archive | spam | trash */
  folder: text("folder").notNull().default("inbox"),
  starred: boolean("starred").notNull().default(false),
  /** Number of unread received messages. */
  unread: integer("unread").notNull().default(0),
  messageCount: integer("message_count").notNull().default(0),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  /** At least one message in the thread was sent from here (the Sent view). */
  hasOutgoing: boolean("has_outgoing").notNull().default(false),
  /** At least one received message (the Inbox view hides threads that are only outgoing). */
  hasIncoming: boolean("has_incoming").notNull().default(false),
  /** People in the conversation other than the mailbox: [{ address, name }]. */
  participants: jsonb("participants").notNull().default([]),
  snippet: text("snippet").notNull().default(""),
  /** A registered applicant in the conversation (by email address). */
  profileId: text("profile_id"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  /** When it was moved to Trash or Spam (emptied after 30 days). */
  binnedAt: timestamp("binned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("demo_mail_threads_list").on(t.mailboxId, t.folder, t.lastMessageAt),
  index("demo_mail_threads_profile").on(t.profileId),
]).enableRLS();

export const demoMailMessagesTable = pgTable("demo_mail_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Null for a draft of a new email (the thread is made when it's sent). */
  threadId: uuid("thread_id"),
  mailboxId: uuid("mailbox_id").notNull(),
  /** in | out */
  direction: text("direction").notNull(),
  /** received | draft | queued (waiting out the undo delay) | sending | sent | failed */
  status: text("status").notNull(),
  /** The Message-ID header (with angle brackets), ours for sent mail. */
  messageId: text("message_id"),
  inReplyTo: text("in_reply_to"),
  references: text("references_header"),
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  /** [{ address, name }] */
  to: jsonb("to_list").notNull().default([]),
  cc: jsonb("cc_list").notNull().default([]),
  bcc: jsonb("bcc_list").notNull().default([]),
  replyTo: jsonb("reply_to_list").notNull().default([]),
  subject: text("subject").notNull().default(""),
  /** Sanitised HTML (received) or the HTML we sent, signature included. */
  html: text("html").notNull().default(""),
  text: text("body_text").notNull().default(""),
  snippet: text("snippet").notNull().default(""),
  /** SPF / DKIM / DMARC results from Resend for received mail: { spf, dkim, dmarc }. */
  authentication: jsonb("authentication"),
  authFailed: boolean("auth_failed").notNull().default(false),
  /** The HTML refers to images on the internet (shown only after "Show images"). */
  remoteImages: boolean("remote_images").notNull().default(false),
  unread: boolean("unread").notNull().default(false),
  /** Resend's id: the received email id, or the sent email id. */
  resendId: text("resend_id"),
  /** Sent mail: the administrator who sent it, when, and the last error. */
  sentBy: text("sent_by"),
  sendAt: timestamp("send_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  error: text("error"),
  /** Draft / reply: include the mailbox signature. */
  withSignature: boolean("with_signature").notNull().default(true),
  /** Forward: the message forwarded (its attachments come along). */
  forwardOf: uuid("forward_of"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("demo_mail_messages_thread").on(t.threadId, t.createdAt),
  index("demo_mail_messages_message_id").on(t.messageId),
  index("demo_mail_messages_status").on(t.status, t.sendAt),
  uniqueIndex("demo_mail_messages_resend").on(t.mailboxId, t.resendId),
]).enableRLS();

/** Attachments of mail (received or sent) and signature logos, stored on the upload disk under `mail/`. */
export const demoMailFilesTable = pgTable("demo_mail_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** attachment | logo */
  purpose: text("purpose").notNull().default("attachment"),
  /** Null while it's uploaded for an email not yet saved, and for logos. */
  messageId: uuid("message_id"),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256"),
  /** Null when the file wasn't kept (refused type or too large); `blockedReason` says why. */
  storedName: text("stored_name"),
  blockedReason: text("blocked_reason"),
  /** Inline image referenced from the HTML as cid:<contentId>. */
  contentId: text("content_id"),
  inline: boolean("inline").notNull().default(false),
  uploadedBy: text("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("demo_mail_files_message").on(t.messageId)]).enableRLS();

/**
 * Resend's webhook calls (by svix-id): answered at once, then processed here with retries. Also stops a replayed call
 * from storing the same email twice.
 */
export const demoMailInboundTable = pgTable("demo_mail_inbound", {
  svixId: text("svix_id").primaryKey(),
  eventType: text("event_type").notNull(),
  emailId: text("email_id"),
  payload: jsonb("payload").notNull(),
  /** waiting | done | failed | ignored */
  status: text("status").notNull().default("waiting"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextTryAt: timestamp("next_try_at", { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  doneAt: timestamp("done_at", { withTimezone: true }),
}, t => [index("demo_mail_inbound_due").on(t.status, t.nextTryAt)]).enableRLS();

export type DemoMailMailbox = typeof demoMailMailboxesTable.$inferSelect;
export type DemoMailThread = typeof demoMailThreadsTable.$inferSelect;
export type DemoMailMessage = typeof demoMailMessagesTable.$inferSelect;
export type DemoMailFile = typeof demoMailFilesTable.$inferSelect;
