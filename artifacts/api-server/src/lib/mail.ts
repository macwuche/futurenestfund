import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, demoAuditTable, demoMailFilesTable, demoMailInboundTable, demoMailMailboxesTable, demoMailMessagesTable, demoMailThreadsTable, demoProfilesTable,
  type DemoMailFile, type DemoMailMailbox, type DemoMailMessage, type DemoMailThread,
} from "@workspace/db";
import { EmailError } from "./email";
import { appName, appBrandColor } from "./emailTemplates";
import { mailDomainConfig, setSystemSender } from "./emailSettings";
import { cleanComposedHtml, cleanEmailHtml } from "./mailHtml";
import {
  type Address, MAX_ATTACHMENTS, MAX_ATTACHMENTS_TOTAL, MAX_RECEIVED_ATTACHMENT_BYTES, MailInputError, authFailed, baseSubject, forwardBlock,
  formatAddress, htmlToText, isEmail, messageIds, newMessageId, parseAddress, parseAddressList, replyQuote, replyReferences, snippetOf, textToHtml,
} from "./mailRules";
import { emptySignature, parseSignature, renderSignature, storedSignature } from "./mailSignature";
import { copyMailFile, readMailFile, removeMailFiles, storeReceivedAttachment } from "./mailStore";
import { downloadAttachment, getReceivedEmail, receivedAttachmentLinks, sendMailOut } from "./resendApi";
import { logger } from "./logger";
import { scrub } from "./monitoring";

/**
 * The admin Mail box (Phase 14, email.md §5): mailboxes on the configured domain, conversations, reading, drafts,
 * sending with an undo delay, reply / reply all / forward, and storing received mail. Every administrator sees every
 * mailbox (decision Q4). Inbound webhook calls are queued in demo_mail_inbound and processed by the worker below.
 */

const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, "") || null;
/** Undo send: how long a sent email waits before it really goes (Gmail-style). */
export const UNDO_SECONDS = Number(process.env.MAIL_UNDO_SECONDS ?? 10);
export const BIN_DAYS = 30;
const PAGE = 50;

const asList = (v: unknown): Address[] => (Array.isArray(v) ? v.filter((a) => a && typeof a === "object" && typeof (a as Address).address === "string") as Address[] : []);

/* ================================================================== mailboxes */

export function requireDomain(): string {
  const d = mailDomainConfig();
  if (!d) throw new MailInputError("Add your email domain first, in Settings → Email.");
  return d.name;
}

export const signatureLogoUrl = (fileId: string | null) => (fileId && appUrl ? `${appUrl}/api/mail/signature-logo/${fileId}` : fileId ? `/api/mail/signature-logo/${fileId}` : null);

export function mailboxSignature(m: Pick<DemoMailMailbox, "signature">) {
  const sig = storedSignature(m.signature ?? emptySignature());
  return renderSignature(sig, { logoUrl: signatureLogoUrl(sig.logoFileId), brandColor: appBrandColor() });
}

/** Tells the email settings which mailbox sends system emails (its address and signature). */
export async function refreshSystemSender() {
  const [m] = await db.select().from(demoMailMailboxesTable).where(and(eq(demoMailMailboxesTable.systemSender, true), eq(demoMailMailboxesTable.enabled, true)));
  const domain = mailDomainConfig()?.name;
  if (!m || !domain || !m.address.endsWith(`@${domain}`)) { setSystemSender(null); return; }
  const sig = mailboxSignature(m);
  setSystemSender({ name: m.displayName, address: m.address, signatureHtml: sig.html, signatureText: sig.text });
}

export async function listMailboxes() {
  const boxes = await db.select().from(demoMailMailboxesTable).orderBy(asc(demoMailMailboxesTable.address));
  const { rows } = await db.execute<{ mailbox_id: string; unread: number; drafts: number; threads: number }>(sql`
    select b.id as mailbox_id,
      coalesce((select sum(t.unread)::int from demo_mail_threads t where t.mailbox_id = b.id and t.folder = 'inbox'), 0) as unread,
      (select count(*)::int from demo_mail_messages m where m.mailbox_id = b.id and m.status = 'draft') as drafts,
      (select count(*)::int from demo_mail_threads t where t.mailbox_id = b.id) as threads
    from demo_mail_mailboxes b`);
  const counts = new Map(rows.map((r) => [r.mailbox_id, r]));
  return boxes.map((b) => mailboxView(b, counts.get(b.id)));
}

function mailboxView(b: DemoMailMailbox, c?: { unread: number; drafts: number; threads: number }) {
  const sig = storedSignature(b.signature ?? emptySignature());
  return {
    id: b.id, address: b.address, displayName: b.displayName, enabled: b.enabled, catchAll: b.catchAll, systemSender: b.systemSender,
    signature: sig, signatureLogoUrl: signatureLogoUrl(sig.logoFileId), signaturePreview: mailboxSignature(b).html,
    unread: c?.unread ?? 0, drafts: c?.drafts ?? 0, threads: c?.threads ?? 0, createdAt: b.createdAt.toISOString(),
  };
}

const NAME_RULE = (s: string) => s.length >= 1 && s.length <= 60 && !/["<>\\\n\r]/.test(s);

export async function createMailbox(input: { address?: unknown; displayName?: unknown }, actor: string) {
  const domain = requireDomain();
  const raw = String(input.address ?? "").trim().toLowerCase();
  const address = raw.includes("@") ? raw : `${raw}@${domain}`;
  if (!isEmail(address) || !address.endsWith(`@${domain}`)) throw new MailInputError(`Use an address on ${domain}, like support@${domain}.`);
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?@/.test(address)) throw new MailInputError("The part before @ can use letters, numbers, dots, dashes and underscores.");
  const displayName = String(input.displayName ?? "").trim() || appName();
  if (!NAME_RULE(displayName)) throw new MailInputError("The display name can be up to 60 characters, without quotes or < >.");
  const existing = await db.select({ id: demoMailMailboxesTable.id }).from(demoMailMailboxesTable);
  const first = existing.length === 0;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(demoMailMailboxesTable).values({
        address, displayName, createdBy: actor, catchAll: first, systemSender: first,
        signature: { ...emptySignature(), name: displayName, footer: domain },
      });
      await tx.insert(demoAuditTable).values({ actor, action: `Mailbox ${address} created${first ? " (catch-all and system emails)" : ""}` });
    });
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if (e.code === "23505" || e.cause?.code === "23505") throw new MailInputError(`${address} already exists.`);
    throw err;
  }
  await refreshSystemSender();
  return listMailboxes();
}

export async function updateMailbox(id: string, input: { displayName?: unknown; enabled?: unknown; catchAll?: unknown; systemSender?: unknown; signature?: unknown }, actor: string) {
  const changes: string[] = [];
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(demoMailMailboxesTable).where(eq(demoMailMailboxesTable.id, id)).for("update");
    if (!m) throw new MailInputError("That mailbox doesn't exist.");
    const set: Partial<DemoMailMailbox> = {};
    if (input.displayName !== undefined) {
      const n = String(input.displayName).trim();
      if (!NAME_RULE(n)) throw new MailInputError("The display name can be up to 60 characters, without quotes or < >.");
      if (n !== m.displayName) { set.displayName = n; changes.push(`name "${n}"`); }
    }
    if (typeof input.enabled === "boolean" && input.enabled !== m.enabled) {
      if (!input.enabled && (m.catchAll || m.systemSender)) throw new MailInputError("Choose another catch-all and system-email mailbox before switching this one off.");
      set.enabled = input.enabled; changes.push(input.enabled ? "switched on" : "switched off");
    }
    if (input.catchAll === true && !m.catchAll) {
      await tx.update(demoMailMailboxesTable).set({ catchAll: false }).where(eq(demoMailMailboxesTable.catchAll, true));
      set.catchAll = true; changes.push("now the catch-all");
    }
    if (input.systemSender === true && !m.systemSender) {
      await tx.update(demoMailMailboxesTable).set({ systemSender: false }).where(eq(demoMailMailboxesTable.systemSender, true));
      set.systemSender = true; changes.push("now sends system emails");
    }
    if (input.signature !== undefined) {
      const sig = parseSignature(input.signature);
      if (sig.logoFileId) {
        const [logo] = await tx.select().from(demoMailFilesTable).where(and(eq(demoMailFilesTable.id, sig.logoFileId), eq(demoMailFilesTable.purpose, "logo")));
        if (!logo) throw new MailInputError("Upload the logo again: it wasn't found.");
      }
      set.signature = sig; changes.push("signature");
    }
    if (!Object.keys(set).length) return;
    await tx.update(demoMailMailboxesTable).set(set).where(eq(demoMailMailboxesTable.id, id));
    await tx.insert(demoAuditTable).values({ actor, action: `Mailbox ${m.address}: ${changes.join(", ")}` });
  });
  await refreshSystemSender();
  return listMailboxes();
}

export async function deleteMailbox(id: string, actor: string) {
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(demoMailMailboxesTable).where(eq(demoMailMailboxesTable.id, id)).for("update");
    if (!m) throw new MailInputError("That mailbox doesn't exist.");
    if (m.catchAll || m.systemSender) throw new MailInputError("Choose another catch-all and system-email mailbox before deleting this one.");
    const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(demoMailMessagesTable).where(eq(demoMailMessagesTable.mailboxId, id));
    if (used!.n > 0) throw new MailInputError("This mailbox has mail in it, so it can only be switched off.");
    await tx.delete(demoMailMailboxesTable).where(eq(demoMailMailboxesTable.id, id));
    await tx.insert(demoAuditTable).values({ actor, action: `Mailbox ${m.address} deleted` });
  });
  return listMailboxes();
}

async function mailbox(id: string, mustBeEnabled = false) {
  const [m] = await db.select().from(demoMailMailboxesTable).where(eq(demoMailMailboxesTable.id, id));
  if (!m) throw new MailInputError("That mailbox doesn't exist.");
  if (mustBeEnabled && !m.enabled) throw new MailInputError(`${m.address} is switched off. Switch it on in Settings → Email to send from it.`);
  return m;
}

/* ================================================================== listing and reading */

export type MailView = "inbox" | "starred" | "sent" | "drafts" | "archive" | "spam" | "trash" | "all";
export const MAIL_VIEWS: MailView[] = ["inbox", "starred", "sent", "drafts", "archive", "spam", "trash", "all"];

function threadSummary(t: DemoMailThread, box: Pick<DemoMailMailbox, "address" | "displayName"> | undefined) {
  return {
    id: t.id, mailboxId: t.mailboxId, mailboxAddress: box?.address ?? "", subject: t.subject || "(no subject)", snippet: t.snippet, folder: t.folder,
    starred: t.starred, unread: t.unread > 0, messageCount: t.messageCount, hasAttachments: t.hasAttachments,
    participants: asList(t.participants), lastMessageAt: t.lastMessageAt.toISOString(), profileId: t.profileId,
  };
}

export async function listThreads(q: { mailboxId?: string; view?: string; search?: string; page?: number; unreadOnly?: boolean; hasAttachments?: boolean }) {
  const view = (MAIL_VIEWS as string[]).includes(q.view ?? "") ? (q.view as MailView) : "inbox";
  const page = Math.max(1, Math.min(1000, Math.floor(q.page ?? 1)));
  const boxes = await db.select().from(demoMailMailboxesTable);
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const mailboxFilter = q.mailboxId && q.mailboxId !== "all" ? sql`and t.mailbox_id = ${q.mailboxId}` : sql``;
  const search = (q.search ?? "").trim().slice(0, 200);

  if (view === "drafts") {
    const drafts = await db.select().from(demoMailMessagesTable)
      .where(and(eq(demoMailMessagesTable.status, "draft"), q.mailboxId && q.mailboxId !== "all" ? eq(demoMailMessagesTable.mailboxId, q.mailboxId) : undefined))
      .orderBy(desc(demoMailMessagesTable.updatedAt)).limit(PAGE).offset((page - 1) * PAGE);
    return {
      view, page, pageSize: PAGE, total: drafts.length + (page - 1) * PAGE, threads: [],
      drafts: drafts.map((d) => ({ id: d.id, mailboxId: d.mailboxId, threadId: d.threadId, subject: d.subject || "(no subject)", to: asList(d.to), snippet: d.snippet, updatedAt: d.updatedAt.toISOString() })),
    };
  }

  const where = {
    inbox: sql`t.folder = 'inbox' and t.has_incoming`,
    starred: sql`t.starred and t.folder <> 'trash'`,
    sent: sql`t.has_outgoing and t.folder not in ('trash','spam')`,
    archive: sql`t.folder = 'archive'`,
    spam: sql`t.folder = 'spam'`,
    trash: sql`t.folder = 'trash'`,
    all: sql`t.folder not in ('trash','spam')`,
  }[view];
  const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const searchFilter = search ? sql`and (t.subject ilike ${like} or t.participants::text ilike ${like} or exists (
      select 1 from demo_mail_messages m where m.thread_id = t.id and m.status <> 'draft'
        and (m.body_text ilike ${like} or m.from_address ilike ${like} or coalesce(m.from_name,'') ilike ${like} or m.to_list::text ilike ${like} or m.cc_list::text ilike ${like}
          or exists (select 1 from demo_mail_files f where f.message_id = m.id and f.original_name ilike ${like}))))` : sql``;
  const extra = sql`${q.unreadOnly ? sql`and t.unread > 0` : sql``} ${q.hasAttachments ? sql`and t.has_attachments` : sql``}`;
  const { rows } = await db.execute<{ id: string; total: number }>(sql`
    select t.id, count(*) over ()::int as total from demo_mail_threads t
    where ${where} ${mailboxFilter} ${searchFilter} ${extra}
    order by t.last_message_at desc limit ${PAGE} offset ${(page - 1) * PAGE}`);
  const ids = rows.map((r) => r.id);
  const threads = ids.length ? await db.select().from(demoMailThreadsTable).where(inArray(demoMailThreadsTable.id, ids)) : [];
  const order = new Map(ids.map((id, i) => [id, i]));
  threads.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { view, page, pageSize: PAGE, total: rows[0]?.total ?? 0, threads: threads.map((t) => threadSummary(t, byId.get(t.mailboxId))), drafts: [] };
}

function fileView(f: DemoMailFile) {
  return {
    id: f.id, name: f.originalName, mimeType: f.mimeType, size: f.sizeBytes, inline: f.inline, contentId: f.contentId,
    available: Boolean(f.storedName), blockedReason: f.blockedReason, url: f.storedName ? `/api/admin/mail/files/${f.id}` : null,
  };
}

function messageView(m: DemoMailMessage, files: DemoMailFile[]) {
  return {
    id: m.id, threadId: m.threadId, mailboxId: m.mailboxId, direction: m.direction, status: m.status,
    from: { address: m.fromAddress, name: m.fromName }, to: asList(m.to), cc: asList(m.cc), bcc: asList(m.bcc), replyTo: asList(m.replyTo),
    subject: m.subject, html: m.html, text: m.text, snippet: m.snippet, unread: m.unread, remoteImages: m.remoteImages, authFailed: m.authFailed,
    authentication: m.authentication ?? null, sentBy: m.sentBy, sendAt: m.sendAt?.toISOString() ?? null, sentAt: m.sentAt?.toISOString() ?? null, error: m.error,
    date: (m.sentAt ?? m.createdAt).toISOString(), withSignature: m.withSignature, forwardOf: m.forwardOf,
    attachments: files.filter((f) => f.messageId === m.id && !(f.inline && f.contentId && m.html.includes(`/api/admin/mail/files/${f.id}`))).map(fileView),
  };
}

/** A conversation with its messages; opening it marks it read. */
export async function getThread(id: string, markRead = true) {
  const [t] = await db.select().from(demoMailThreadsTable).where(eq(demoMailThreadsTable.id, id));
  if (!t) throw new MailInputError("That conversation doesn't exist any more.");
  const messages = await db.select().from(demoMailMessagesTable).where(eq(demoMailMessagesTable.threadId, id)).orderBy(asc(demoMailMessagesTable.createdAt));
  const ids = messages.map((m) => m.id);
  const files = ids.length ? await db.select().from(demoMailFilesTable).where(inArray(demoMailFilesTable.messageId, ids)) : [];
  if (markRead && t.unread > 0) {
    await db.update(demoMailMessagesTable).set({ unread: false }).where(and(eq(demoMailMessagesTable.threadId, id), eq(demoMailMessagesTable.unread, true)));
    await db.update(demoMailThreadsTable).set({ unread: 0 }).where(eq(demoMailThreadsTable.id, id));
    t.unread = 0;
    for (const m of messages) m.unread = false;
  }
  const box = await mailbox(t.mailboxId);
  let profile: { id: string; name: string; email: string; organization: string; tier: number; status: string; verificationLevel: string } | null = null;
  if (t.profileId) {
    const [p] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, t.profileId));
    if (p) profile = { id: p.id, name: p.name, email: p.email, organization: p.organization, tier: p.tier, status: p.status, verificationLevel: p.verificationLevel };
  }
  return {
    thread: threadSummary(t, box),
    messages: messages.filter((m) => m.status !== "draft").map((m) => messageView(m, files)),
    drafts: messages.filter((m) => m.status === "draft").map((m) => messageView(m, files)),
    profile,
  };
}

export async function updateThreads(input: { ids?: unknown; unread?: unknown; starred?: unknown; folder?: unknown }, actor: string) {
  const ids = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200) : [];
  if (!ids.length) throw new MailInputError("Choose at least one conversation.");
  const folder = typeof input.folder === "string" ? input.folder : undefined;
  if (folder && !["inbox", "archive", "spam", "trash"].includes(folder)) throw new MailInputError("Unknown folder.");
  await db.transaction(async (tx) => {
    if (typeof input.starred === "boolean") await tx.update(demoMailThreadsTable).set({ starred: input.starred }).where(inArray(demoMailThreadsTable.id, ids));
    if (typeof input.unread === "boolean") {
      if (input.unread) {
        // Mark the latest received message unread (Gmail marks the conversation; we need a message to count).
        await tx.execute(sql`update demo_mail_messages m set unread = true where m.id in (
          select distinct on (thread_id) id from demo_mail_messages where thread_id in ${sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`} and direction = 'in' order by thread_id, created_at desc)`);
      } else await tx.update(demoMailMessagesTable).set({ unread: false }).where(inArray(demoMailMessagesTable.threadId, ids));
      await tx.execute(sql`update demo_mail_threads t set unread = (select count(*)::int from demo_mail_messages m where m.thread_id = t.id and m.unread) where t.id in ${sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`}`);
    }
    if (folder) {
      await tx.update(demoMailThreadsTable).set({ folder, binnedAt: folder === "trash" || folder === "spam" ? new Date() : null }).where(inArray(demoMailThreadsTable.id, ids));
      if (folder === "spam" || folder === "trash") await tx.insert(demoAuditTable).values({ actor, action: `Mail: ${ids.length} conversation${ids.length > 1 ? "s" : ""} moved to ${folder === "spam" ? "Spam" : "Trash"}` });
    }
  });
  return { updated: ids.length };
}

/** Deletes conversations for good (only from Trash or Spam). */
export async function deleteThreadsForever(rawIds: unknown, actor: string) {
  const ids = Array.isArray(rawIds) ? rawIds.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200) : [];
  if (!ids.length) throw new MailInputError("Choose at least one conversation.");
  const threads = await db.select().from(demoMailThreadsTable).where(inArray(demoMailThreadsTable.id, ids));
  if (threads.some((t) => t.folder !== "trash" && t.folder !== "spam")) throw new MailInputError("Move conversations to Trash before deleting them for good.");
  const n = await purgeThreads(threads.map((t) => t.id));
  await db.insert(demoAuditTable).values({ actor, action: `Mail: ${n} conversation${n === 1 ? "" : "s"} deleted for good` });
  return { deleted: n };
}

async function purgeThreads(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const msgs = await db.select({ id: demoMailMessagesTable.id }).from(demoMailMessagesTable).where(inArray(demoMailMessagesTable.threadId, ids));
  const files = msgs.length ? await db.select({ id: demoMailFilesTable.id }).from(demoMailFilesTable).where(inArray(demoMailFilesTable.messageId, msgs.map((m) => m.id))) : [];
  await db.transaction(async (tx) => {
    if (msgs.length) await tx.delete(demoMailMessagesTable).where(inArray(demoMailMessagesTable.threadId, ids));
    await tx.delete(demoMailThreadsTable).where(inArray(demoMailThreadsTable.id, ids));
  });
  await removeMailFiles(files.map((f) => f.id));
  return ids.length;
}

/** Empties Trash and Spam of conversations moved there more than 30 days ago (decision Q9). */
export async function emptyOldBins(): Promise<number> {
  const old = await db.select({ id: demoMailThreadsTable.id }).from(demoMailThreadsTable)
    .where(sql`${demoMailThreadsTable.folder} in ('trash','spam') and ${demoMailThreadsTable.binnedAt} < now() - make_interval(days => ${BIN_DAYS})`).limit(500);
  const n = await purgeThreads(old.map((t) => t.id));
  if (n) logger.info({ n }, "Mail: emptied old Trash / Spam");
  // Attachments uploaded in Compose and never used, and logos no mailbox uses, after a day.
  const { rows } = await db.execute<{ id: string }>(sql`select f.id from demo_mail_files f where f.message_id is null and f.created_at < now() - interval '1 day'
    and not exists (select 1 from demo_mail_mailboxes b where b.signature ->> 'logoFileId' = f.id::text)`);
  await removeMailFiles(rows.map((r) => r.id));
  return n;
}

/* ================================================================== composing and sending */

export type ComposeInput = {
  id?: unknown; mailboxId?: unknown; to?: unknown; cc?: unknown; bcc?: unknown; subject?: unknown; html?: unknown;
  replyToMessageId?: unknown; forwardOfMessageId?: unknown; attachmentIds?: unknown; withSignature?: unknown;
};

type Parsed = {
  id: string | null; mailboxId: string; to: Address[]; cc: Address[]; bcc: Address[]; subject: string; html: string;
  replyTo: DemoMailMessage | null; forwardOf: DemoMailMessage | null; attachmentIds: string[]; withSignature: boolean;
};

async function parseCompose(input: ComposeInput, sending: boolean): Promise<Parsed> {
  const mailboxId = String(input.mailboxId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(mailboxId)) throw new MailInputError("Choose the mailbox to send from.");
  const to = parseAddressList(input.to as string | string[] | undefined);
  const cc = parseAddressList(input.cc as string | string[] | undefined);
  const bcc = parseAddressList(input.bcc as string | string[] | undefined);
  if (sending && !to.length && !cc.length && !bcc.length) throw new MailInputError("Add at least one recipient.");
  if (to.length + cc.length + bcc.length > 50) throw new MailInputError("An email can go to at most 50 people.");
  const subject = String(input.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
  const rawHtml = String(input.html ?? "");
  if (rawHtml.length > 500_000) throw new MailInputError("The email is too long.");
  const html = cleanComposedHtml(rawHtml);
  const msg = async (v: unknown) => {
    if (!v) return null;
    const [m] = await db.select().from(demoMailMessagesTable).where(eq(demoMailMessagesTable.id, String(v)));
    if (!m || m.status === "draft") throw new MailInputError("The email you're answering doesn't exist any more.");
    return m;
  };
  const attachmentIds = Array.isArray(input.attachmentIds) ? [...new Set(input.attachmentIds.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))] : [];
  if (attachmentIds.length > MAX_ATTACHMENTS) throw new MailInputError(`An email can carry at most ${MAX_ATTACHMENTS} attachments.`);
  return {
    id: input.id ? String(input.id) : null, mailboxId, to, cc, bcc, subject, html,
    replyTo: await msg(input.replyToMessageId), forwardOf: await msg(input.forwardOfMessageId), attachmentIds, withSignature: input.withSignature !== false,
  };
}

/**
 * Saves a draft (new or existing) with its attachments. Attachment ids are files uploaded in Compose (not yet on a
 * message), files already on this draft, or — when forwarding — the forwarded message's files (copied).
 */
async function saveDraftRecord(p: Parsed, actor: string): Promise<DemoMailMessage> {
  const box = await mailbox(p.mailboxId);
  return db.transaction(async (tx) => {
    let draft: DemoMailMessage | undefined;
    if (p.id) {
      [draft] = await tx.select().from(demoMailMessagesTable).where(eq(demoMailMessagesTable.id, p.id)).for("update");
      if (!draft || draft.status !== "draft") throw new MailInputError("This draft was already sent or deleted.");
    }
    const text = htmlToText(p.html);
    const values = {
      mailboxId: box.id, direction: "out", status: "draft", fromAddress: box.address, fromName: box.displayName,
      to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject, html: p.html, text, snippet: snippetOf(text),
      threadId: p.replyTo?.threadId ?? draft?.threadId ?? null, inReplyTo: p.replyTo?.messageId ?? null,
      references: p.replyTo ? replyReferences(p.replyTo) : null, forwardOf: p.forwardOf?.id ?? null, withSignature: p.withSignature, updatedAt: new Date(),
    };
    if (draft) [draft] = await tx.update(demoMailMessagesTable).set(values).where(eq(demoMailMessagesTable.id, draft.id)).returning();
    else [draft] = await tx.insert(demoMailMessagesTable).values({ ...values, sentBy: actor }).returning();
    const id = draft!.id;
    // Attachments: keep the wanted ones, drop the rest.
    const current = await tx.select().from(demoMailFilesTable).where(eq(demoMailFilesTable.messageId, id));
    const wanted = new Set(p.attachmentIds);
    const drop = current.filter((f) => !wanted.has(f.id)).map((f) => f.id);
    const have = new Set(current.map((f) => f.id));
    const add = p.attachmentIds.filter((x) => !have.has(x));
    if (add.length) {
      const rows = await tx.select().from(demoMailFilesTable).where(inArray(demoMailFilesTable.id, add));
      for (const f of rows) {
        if (f.purpose !== "attachment") continue;
        if (f.messageId === null) await tx.update(demoMailFilesTable).set({ messageId: id }).where(eq(demoMailFilesTable.id, f.id));
        else if (p.forwardOf && f.messageId === p.forwardOf.id) await copyMailFile(tx, f, id, actor);
      }
    }
    const all = await tx.select().from(demoMailFilesTable).where(eq(demoMailFilesTable.messageId, id));
    const keep = all.filter((f) => !drop.includes(f.id));
    if (keep.length > MAX_ATTACHMENTS) throw new MailInputError(`An email can carry at most ${MAX_ATTACHMENTS} attachments.`);
    if (keep.reduce((s, f) => s + f.sizeBytes, 0) > MAX_ATTACHMENTS_TOTAL) throw new MailInputError(`Attachments can add up to ${MAX_ATTACHMENTS_TOTAL / 1024 / 1024} MB per email.`);
    if (keep.some((f) => !f.storedName)) throw new MailInputError("One of the attachments wasn't kept when it arrived, so it can't be sent on.");
    if (drop.length) await tx.update(demoMailFilesTable).set({ messageId: null }).where(inArray(demoMailFilesTable.id, drop));
    return draft!;
  });
}

export async function saveDraft(input: ComposeInput, actor: string) {
  const d = await saveDraftRecord(await parseCompose(input, false), actor);
  return draftView(d.id);
}

async function draftView(id: string) {
  const [m] = await db.select().from(demoMailMessagesTable).where(eq(demoMailMessagesTable.id, id));
  if (!m) throw new MailInputError("Draft not found.");
  const files = await db.select().from(demoMailFilesTable).where(eq(demoMailFilesTable.messageId, id));
  return messageView(m, files);
}

export async function getDraft(id: string) { return draftView(id); }

export async function deleteDraft(id: string) {
  const [m] = await db.select().from(demoMailMessagesTable).where(eq(demoMailMessagesTable.id, id));
  if (!m || m.status !== "draft") throw new MailInputError("This draft was already sent or deleted.");
  const files = await db.select({ id: demoMailFilesTable.id }).from(demoMailFilesTable).where(eq(demoMailFilesTable.messageId, id));
  await db.delete(demoMailMessagesTable).where(eq(demoMailMessagesTable.id, id));
  await removeMailFiles(files.map((f) => f.id));
  return { deleted: true };
}

/**
 * Send: saves the email, puts it in the conversation as "queued" and sends it after the undo delay (worker below).
 * The thread is created now, so the email shows in Sent at once with "Sending…".
 */
export async function sendMail(input: ComposeInput, actor: string) {
  const domain = requireDomain();
  const p = await parseCompose(input, true);
  const box = await mailbox(p.mailboxId, true);
  if (!box.address.endsWith(`@${domain}`)) throw new MailInputError(`${box.address} isn't on ${domain}, so it can't send.`);
  const draft = await saveDraftRecord(p, actor);
  const result = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(demoMailMessagesTable).where(eq(demoMailMessagesTable.id, draft.id)).for("update");
    if (!m || m.status !== "draft") throw new MailInputError("This email was already sent.");
    const now = new Date();
    let threadId = m.threadId;
    const people = [...p.to, ...p.cc, ...p.bcc];
    if (threadId) {
      const [t] = await tx.select().from(demoMailThreadsTable).where(eq(demoMailThreadsTable.id, threadId)).for("update");
      if (!t || t.mailboxId !== box.id) threadId = null;
    }
    const profileId = await profileFor(tx, people.map((a) => a.address));
    const files = await tx.select({ id: demoMailFilesTable.id }).from(demoMailFilesTable).where(eq(demoMailFilesTable.messageId, m.id));
    if (!threadId) {
      const [t] = await tx.insert(demoMailThreadsTable).values({
        mailboxId: box.id, subject: p.subject, folder: "inbox", participants: people, snippet: m.snippet, profileId, lastMessageAt: now,
        messageCount: 0, hasOutgoing: true, hasIncoming: false, hasAttachments: files.length > 0,
      }).returning();
      threadId = t!.id;
    }
    await tx.execute(sql`update demo_mail_threads set message_count = message_count + 1, has_outgoing = true, last_message_at = ${now},
      snippet = ${m.snippet}, has_attachments = has_attachments or ${files.length > 0}, profile_id = coalesce(profile_id, ${profileId}),
      folder = case when folder in ('trash','spam') then 'inbox' else folder end, binned_at = case when folder in ('trash','spam') then null else binned_at end
      where id = ${threadId}`);
    const sendAt = new Date(now.getTime() + UNDO_SECONDS * 1000);
    const [queued] = await tx.update(demoMailMessagesTable).set({
      status: "queued", threadId, sendAt, sentBy: actor, messageId: newMessageId(m.id, domain), updatedAt: now, error: null,
    }).where(eq(demoMailMessagesTable.id, m.id)).returning();
    await tx.insert(demoAuditTable).values({ actor, action: `Mail: email "${scrub(p.subject || "(no subject)", 80)}" sent from ${box.address} to ${people.length} recipient${people.length > 1 ? "s" : ""}` });
    return queued!;
  });
  const delay = Math.max(0, result.sendAt!.getTime() - Date.now());
  setTimeout(() => void runSendQueue(), delay + 200).unref();
  return { id: result.id, threadId: result.threadId!, sendAt: result.sendAt!.toISOString(), undoSeconds: UNDO_SECONDS };
}

/** Undo send: while the email still waits, it goes back to being a draft. */
export async function undoSend(id: string, actor: string) {
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(demoMailMessagesTable).where(eq(demoMailMessagesTable.id, id)).for("update");
    if (!m || m.status !== "queued") throw new MailInputError("Too late: the email has already been sent.");
    await tx.update(demoMailMessagesTable).set({ status: "draft", sendAt: null, messageId: null, updatedAt: new Date() }).where(eq(demoMailMessagesTable.id, id));
    if (m.threadId) {
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from demo_mail_messages where thread_id = ${m.threadId} and status <> 'draft'`)).rows as [{ n: number }];
      if (n === 0) {
        await tx.update(demoMailMessagesTable).set({ threadId: null }).where(eq(demoMailMessagesTable.id, id));
        await tx.delete(demoMailThreadsTable).where(eq(demoMailThreadsTable.id, m.threadId));
      } else {
        await tx.execute(sql`update demo_mail_threads t set message_count = ${n},
          has_outgoing = exists (select 1 from demo_mail_messages m where m.thread_id = t.id and m.direction = 'out' and m.status <> 'draft'),
          last_message_at = (select max(coalesce(sent_at, send_at, created_at)) from demo_mail_messages m where m.thread_id = t.id and m.status <> 'draft')
          where t.id = ${m.threadId}`);
      }
    }
    await tx.insert(demoAuditTable).values({ actor, action: `Mail: sending of "${scrub(m.subject || "(no subject)", 80)}" undone` });
  });
  return draftView(id);
}

/** Builds what goes out: the body, the signature, and the quoted / forwarded original. */
async function buildOutgoing(m: DemoMailMessage) {
  const box = await mailbox(m.mailboxId);
  const sig = m.withSignature ? mailboxSignature(box) : { html: "", text: "" };
  let tailHtml = "", tailText = "";
  if (m.forwardOf) {
    const [orig] = await db.select().from(demoMailMessagesTable).where(eq(demoMailMessagesTable.id, m.forwardOf));
    if (orig) {
      const f = forwardBlock({ fromAddress: orig.fromAddress, fromName: orig.fromName, date: orig.sentAt ?? orig.createdAt, subject: orig.subject, to: asList(orig.to), cc: asList(orig.cc), html: orig.html, text: orig.text });
      tailHtml = f.html; tailText = f.text;
    }
  } else if (m.inReplyTo) {
    const [orig] = await db.select().from(demoMailMessagesTable).where(and(eq(demoMailMessagesTable.messageId, m.inReplyTo), eq(demoMailMessagesTable.mailboxId, m.mailboxId)));
    if (orig) {
      const q = replyQuote({ fromAddress: orig.fromAddress, fromName: orig.fromName, date: orig.sentAt ?? orig.createdAt, html: orig.html, text: orig.text });
      tailHtml = q.html; tailText = q.text;
    }
  }
  // Images in the quoted original point at our own (signed-in) file URLs: recipients can't load them, so drop them.
  tailHtml = tailHtml.replace(/<img[^>]+src="\/api\/admin\/mail\/files\/[^"]+"[^>]*>/gi, "");
  const body = m.html.trim() || textToHtml(m.text);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#202124">${body}${sig.html}${tailHtml}</div>`;
  const text = `${htmlToText(body)}${sig.text ? `\n\n${sig.text}` : ""}${tailText}`;
  return { box, html, text };
}

/** Sends every queued email whose undo delay is over. Claimed with a lease so two servers never send the same one. */
let sending = false;
export async function runSendQueue(): Promise<number> {
  if (sending) return 0;
  sending = true;
  let sent = 0;
  try {
    const { rows } = await db.execute<{ id: string }>(sql`
      update demo_mail_messages set status = 'sending', updated_at = now()
      where id in (select id from demo_mail_messages where status = 'queued' and send_at <= now() order by send_at limit 10 for update skip locked)
      returning id`);
    for (const { id } of rows) {
      const [m] = await db.select().from(demoMailMessagesTable).where(eq(demoMailMessagesTable.id, id));
      if (!m) continue;
      try {
        const { box, html, text } = await buildOutgoing(m);
        const files = await db.select().from(demoMailFilesTable).where(eq(demoMailFilesTable.messageId, m.id));
        const attachments = await Promise.all(files.map(async (f) => ({ filename: f.originalName, content: await readMailFile(f), contentType: f.mimeType })));
        const headers: Record<string, string> = { "Message-ID": m.messageId! };
        if (m.inReplyTo) headers["In-Reply-To"] = m.inReplyTo;
        if (m.references) headers["References"] = m.references;
        const resendId = await sendMailOut({
          from: formatAddress({ address: box.address, name: box.displayName }), to: asList(m.to).map(formatAddress), cc: asList(m.cc).map(formatAddress), bcc: asList(m.bcc).map(formatAddress),
          subject: m.subject || "(no subject)", html, text, headers, attachments,
        }, `mail-${m.id}`);
        await db.update(demoMailMessagesTable).set({ status: "sent", sentAt: new Date(), resendId: resendId || null, html: html, text, error: null, updatedAt: new Date() }).where(eq(demoMailMessagesTable.id, m.id));
        sent++;
      } catch (err) {
        const retry = err instanceof EmailError && err.retryable;
        const msg = scrub((err as Error).message, 300);
        logger.warn({ id: m.id, err: msg, retry }, "Mail: sending failed");
        await db.update(demoMailMessagesTable).set(retry && !(m.error?.startsWith("[3]"))
          ? { status: "queued", sendAt: new Date(Date.now() + 60_000), error: `[${Number(/^\[(\d)\]/.exec(m.error ?? "")?.[1] ?? 0) + 1}] ${msg}` }
          : { status: "failed", error: msg }).where(eq(demoMailMessagesTable.id, m.id));
      }
    }
  } finally {
    sending = false;
  }
  return sent;
}

/** Puts a failed email back to draft so it can be fixed and sent again. */
export async function retryFailed(id: string) {
  const [m] = await db.select().from(demoMailMessagesTable).where(eq(demoMailMessagesTable.id, id));
  if (!m || m.status !== "failed") throw new MailInputError("Only an email that failed can be retried.");
  await db.update(demoMailMessagesTable).set({ status: "queued", sendAt: new Date(), error: null }).where(eq(demoMailMessagesTable.id, id));
  setTimeout(() => void runSendQueue(), 200).unref();
  return { id };
}

/* ================================================================== receiving */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function profileFor(tx: Tx | typeof db, addresses: string[]): Promise<string | null> {
  const list = [...new Set(addresses.map((a) => a.toLowerCase()))].slice(0, 50);
  if (!list.length) return null;
  const { rows } = await tx.execute<{ id: string }>(sql`select id from demo_profiles where lower(email) in ${sql`(${sql.join(list.map((a) => sql`${a}`), sql`, `)})`} order by auth_user_id is null limit 1`);
  return rows[0]?.id ?? null;
}

/** Which of our mailboxes an email is for: the addressed ones, else the catch-all (decision Q5). */
async function mailboxesFor(recipients: string[], domain: string) {
  const ours = [...new Set(recipients.map((r) => parseAddress(r)?.address).filter((a): a is string => Boolean(a) && a!.endsWith(`@${domain}`)))];
  const boxes = await db.select().from(demoMailMailboxesTable).where(eq(demoMailMailboxesTable.enabled, true));
  const hit = boxes.filter((b) => ours.includes(b.address));
  if (hit.length) return hit;
  const catchAll = boxes.find((b) => b.catchAll);
  return catchAll && ours.length ? [catchAll] : [];
}

/** Stores one received email (by Resend id) in each mailbox it's for. Returns how many copies were stored. */
export async function storeReceived(emailId: string): Promise<number> {
  const domain = mailDomainConfig()?.name;
  if (!domain) throw new Error("No mail domain configured");
  const r = await getReceivedEmail(emailId);
  const boxes = await mailboxesFor([...r.to, ...r.cc, ...r.bcc, ...r.receivedFor], domain);
  if (!boxes.length) { logger.info({ emailId }, "Mail: received email for no mailbox; ignored"); return 0; }
  const links = r.attachments.length ? await receivedAttachmentLinks(emailId).catch(() => new Map<string, string>()) : new Map<string, string>();
  const downloads = new Map<string, Buffer | "too-large" | null>();
  for (const a of r.attachments) {
    const url = links.get(a.id);
    downloads.set(a.id, url ? await downloadAttachment(url, MAX_RECEIVED_ATTACHMENT_BYTES).catch((err) => { logger.warn({ err: (err as Error).message }, "Mail: attachment download failed"); return null; }) : null);
  }
  const from = parseAddress(r.from) ?? { address: r.from.toLowerCase().slice(0, 254) || "unknown@unknown", name: null };
  const toList = r.to.map(parseAddress).filter(Boolean) as Address[];
  const ccList = r.cc.map(parseAddress).filter(Boolean) as Address[];
  const replyTo = r.replyTo.map(parseAddress).filter(Boolean) as Address[];
  const inReplyTo = messageIds(r.headers["in-reply-to"])[0] ?? null;
  const references = r.headers["references"] ? messageIds(r.headers["references"]).slice(-20).join(" ") || null : null;
  const failed = authFailed(r.authentication);
  const received = r.createdAt ? new Date(r.createdAt) : new Date();
  let stored = 0;
  for (const box of boxes) {
    await db.transaction(async (tx) => {
      const [dupe] = await tx.select({ id: demoMailMessagesTable.id }).from(demoMailMessagesTable).where(and(eq(demoMailMessagesTable.mailboxId, box.id), eq(demoMailMessagesTable.resendId, emailId)));
      if (dupe) return;
      // The thread: a message it answers or refers to, in this mailbox; else same subject with the same person in 30 days.
      const refs = [...new Set([inReplyTo, ...messageIds(references)].filter((x): x is string => Boolean(x)))];
      let thread: DemoMailThread | undefined;
      if (refs.length) {
        const [hit] = await tx.select({ threadId: demoMailMessagesTable.threadId }).from(demoMailMessagesTable)
          .where(and(eq(demoMailMessagesTable.mailboxId, box.id), inArray(demoMailMessagesTable.messageId, refs))).limit(1);
        if (hit?.threadId) [thread] = await tx.select().from(demoMailThreadsTable).where(eq(demoMailThreadsTable.id, hit.threadId)).for("update");
      }
      const subject = baseSubject(r.subject);
      if (!thread && subject) {
        const { rows } = await tx.execute<{ id: string }>(sql`select id from demo_mail_threads where mailbox_id = ${box.id} and lower(subject) = lower(${subject})
          and participants::text ilike ${`%"${from.address}"%`} and last_message_at > now() - interval '30 days' order by last_message_at desc limit 1`);
        if (rows[0]) [thread] = await tx.select().from(demoMailThreadsTable).where(eq(demoMailThreadsTable.id, rows[0].id)).for("update");
      }
      const profileId = await profileFor(tx, [from.address]);
      const people = [from, ...toList, ...ccList].filter((a, i, all) => a.address !== box.address && all.findIndex((x) => x.address === a.address) === i);
      if (!thread) {
        [thread] = await tx.insert(demoMailThreadsTable).values({ mailboxId: box.id, subject: r.subject.slice(0, 300) || "", participants: people, profileId, lastMessageAt: received }).returning();
      }
      // Body: placeholder first (we need the message id to name the files), then the HTML with cid: images resolved.
      const [msg] = await tx.insert(demoMailMessagesTable).values({
        threadId: thread!.id, mailboxId: box.id, direction: "in", status: "received", messageId: r.messageId, inReplyTo, references,
        fromAddress: from.address, fromName: from.name, to: toList, cc: ccList, bcc: [], replyTo, subject: r.subject.slice(0, 300),
        html: "", text: "", snippet: "", authentication: r.authentication as object | null, authFailed: failed, unread: true, resendId: emailId, createdAt: received,
      }).returning();
      const cids = new Map<string, string>();
      let attached = 0;
      for (const a of r.attachments) {
        const f = await storeReceivedAttachment(tx, msg!.id, { filename: a.filename, contentType: a.contentType, contentId: a.contentId, inline: a.disposition === "inline" && Boolean(a.contentId), size: a.size },
          downloads.get(a.id) ?? null, MAX_RECEIVED_ATTACHMENT_BYTES);
        if (a.contentId && f.storedName && f.mimeType.startsWith("image/")) cids.set(a.contentId, `/api/admin/mail/files/${f.id}`);
        if (!(a.disposition === "inline" && a.contentId)) attached++;
      }
      const clean = r.html ? cleanEmailHtml(r.html, (cid) => cids.get(cid) ?? null) : { html: textToHtml(r.text ?? ""), remoteImages: false };
      const text = r.text ?? htmlToText(clean.html);
      const snippet = snippetOf(text);
      await tx.update(demoMailMessagesTable).set({ html: clean.html, text, snippet, remoteImages: clean.remoteImages }).where(eq(demoMailMessagesTable.id, msg!.id));
      const participants = [...asList(thread!.participants)];
      for (const pp of people) if (!participants.some((x) => x.address === pp.address)) participants.push(pp);
      await tx.update(demoMailThreadsTable).set({
        messageCount: thread!.messageCount + 1, unread: thread!.unread + 1, hasIncoming: true, hasAttachments: thread!.hasAttachments || attached > 0,
        lastMessageAt: received > thread!.lastMessageAt ? received : thread!.lastMessageAt, snippet, participants: participants.slice(0, 50),
        profileId: thread!.profileId ?? profileId,
        // New mail brings an archived conversation back to the inbox (Gmail does the same); Spam and Trash stay put.
        folder: thread!.folder === "archive" ? "inbox" : thread!.folder,
      }).where(eq(demoMailThreadsTable.id, thread!.id));
      stored++;
    });
  }
  return stored;
}

/** Delivery news for an email we sent from a mailbox (bounced, complained, failed). */
async function recordDeliveryEvent(type: string, emailId: string, payload: Record<string, unknown>) {
  const [m] = await db.select().from(demoMailMessagesTable).where(and(eq(demoMailMessagesTable.resendId, emailId), eq(demoMailMessagesTable.direction, "out")));
  if (!m) return false;
  const data = (payload["data"] ?? {}) as Record<string, unknown>;
  const bounce = (data["bounce"] ?? {}) as Record<string, unknown>;
  const reason = type === "email.bounced" ? `Bounced: ${String(bounce["message"] ?? bounce["subType"] ?? "the recipient's server refused it")}`
    : type === "email.complained" ? "The recipient marked it as spam." : type === "email.failed" ? `Failed: ${String((data["failed"] as Record<string, unknown> | undefined)?.["reason"] ?? "Resend couldn't deliver it")}`
    : type === "email.delivery_delayed" ? "Delivery is delayed; Resend keeps trying." : null;
  if (reason) await db.update(demoMailMessagesTable).set({ error: scrub(reason, 300) }).where(eq(demoMailMessagesTable.id, m.id));
  else if (type === "email.delivered") await db.update(demoMailMessagesTable).set({ error: null }).where(and(eq(demoMailMessagesTable.id, m.id), sql`${demoMailMessagesTable.error} like 'Delivery is delayed%'`));
  return true;
}

/** Processes queued webhook calls (received mail and delivery events) with retries: 1, 2, 4… minutes, 8 tries. */
let inboundRunning = false;
export async function runInboundQueue(): Promise<number> {
  if (inboundRunning) return 0;
  inboundRunning = true;
  let done = 0;
  try {
    const { rows } = await db.execute<{ svix_id: string }>(sql`
      update demo_mail_inbound set attempts = attempts + 1, next_try_at = now() + interval '5 minutes'
      where svix_id in (select svix_id from demo_mail_inbound where status = 'waiting' and next_try_at <= now() order by received_at limit 10 for update skip locked)
      returning svix_id`);
    for (const { svix_id } of rows) {
      const [ev] = await db.select().from(demoMailInboundTable).where(eq(demoMailInboundTable.svixId, svix_id));
      if (!ev) continue;
      try {
        let status = "done";
        if (ev.eventType === "email.received" && ev.emailId) { if (!(await storeReceived(ev.emailId))) status = "ignored"; }
        else if (ev.emailId && ev.eventType.startsWith("email.")) { if (!(await recordDeliveryEvent(ev.eventType, ev.emailId, ev.payload as Record<string, unknown>))) status = "ignored"; }
        else status = "ignored";
        await db.update(demoMailInboundTable).set({ status, doneAt: new Date(), lastError: null }).where(eq(demoMailInboundTable.svixId, svix_id));
        done++;
      } catch (err) {
        const msg = scrub((err as Error).message, 300);
        const gaveUp = ev.attempts >= 8;
        logger.warn({ svixId: svix_id, err: msg, attempt: ev.attempts }, "Mail: processing a webhook call failed");
        await db.update(demoMailInboundTable).set({
          status: gaveUp ? "failed" : "waiting", lastError: msg, nextTryAt: new Date(Date.now() + Math.min(60, 2 ** (ev.attempts - 1)) * 60_000),
        }).where(eq(demoMailInboundTable.svixId, svix_id));
      }
    }
  } finally {
    inboundRunning = false;
  }
  return done;
}

/** Queues a verified webhook call; true when it's new (a replay returns false and is answered without work). */
export async function queueInbound(svixId: string, payload: Record<string, unknown>): Promise<boolean> {
  const data = (payload["data"] ?? {}) as Record<string, unknown>;
  const rows = await db.insert(demoMailInboundTable).values({
    svixId, eventType: String(payload["type"] ?? "unknown").slice(0, 60), emailId: data["email_id"] ? String(data["email_id"]).slice(0, 100) : null, payload,
  }).onConflictDoNothing().returning({ id: demoMailInboundTable.svixId });
  if (rows.length) setImmediate(() => void runInboundQueue());
  return rows.length > 0;
}

export async function inboundStats() {
  const { rows: [r] } = await db.execute<{ last_at: string | null; last_status: string | null; last_error: string | null; waiting: number; failed: number; received_today: number; sent_today: number }>(sql`
    select (select max(received_at)::text from demo_mail_inbound) as last_at,
      (select status from demo_mail_inbound order by received_at desc limit 1) as last_status,
      (select last_error from demo_mail_inbound where last_error is not null order by received_at desc limit 1) as last_error,
      (select count(*)::int from demo_mail_inbound where status = 'waiting') as waiting,
      (select count(*)::int from demo_mail_inbound where status = 'failed' and received_at > now() - interval '7 days') as failed,
      (select count(*)::int from demo_mail_messages where direction = 'in' and created_at > now() - interval '24 hours') as received_today,
      (select count(*)::int from demo_mail_messages where direction = 'out' and status = 'sent' and sent_at > now() - interval '24 hours') as sent_today`);
  const { rows: [n] } = await db.execute<{ n: number }>(sql`select count(*)::int as n from demo_notifications where emailed_at > now() - interval '24 hours'`);
  return {
    lastCallAt: r!.last_at ? new Date(r!.last_at).toISOString() : null, lastStatus: r!.last_status, lastError: r!.last_error, waiting: r!.waiting, failed: r!.failed,
    receivedLast24h: r!.received_today, sentLast24h: r!.sent_today, systemSentLast24h: n!.n,
  };
}

/* ================================================================== workers */

export function startMailWorkers() {
  void refreshSystemSender().catch((err) => logger.warn({ err: (err as Error).message }, "Mail: system sender not loaded"));
  const every = (ms: number, fn: () => Promise<unknown>, label: string) => {
    const tick = async () => {
      try { await fn(); } catch (err) { logger.error({ err: (err as Error).message }, `Mail: ${label} failed`); }
      setTimeout(tick, ms).unref();
    };
    setTimeout(tick, Math.min(ms, 5_000)).unref();
  };
  every(5_000, runSendQueue, "send queue");
  every(15_000, runInboundQueue, "inbound queue");
  every(60 * 60_000, emptyOldBins, "emptying Trash");
  every(60_000, refreshSystemSender, "system sender refresh");
}
