/**
 * Card payments (Phase 13). Customers who collected a physical card at the office save it here, then pick it when they
 * deposit (the card is charged) or withdraw (the money is sent to the card) through a payment method of type "card".
 *
 * - The number and CVV are sealed with the settings master key (secretBox.ts, AES-256-GCM, field-bound). Lists only ever
 *   carry the last four; `revealCard` opens one card for an administrator and audits it.
 * - `number_hash` is an HMAC of the number under a key derived from the master key: it finds the same card on another
 *   account or on the reported list without opening anything, and isn't reversible without the key.
 * - A saved card is Active at once and the customer is emailed that it was added; administrators approve each deposit
 *   and withdrawal made with it. They can block a card and keep the reported list (lost / stolen / expired). A blocked,
 *   reported or expired card can't be used for a new request, and requests made with it can't be approved.
 */
import { createHmac } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  db, demoAuditTable, demoPaymentCardsTable, demoPaymentMethodsTable, demoProfilesTable, demoReportedCardsTable, demoRequestsTable,
  type DemoPaymentCard, type DemoReportedCard,
} from "@workspace/db";
import { DemoInputError } from "./demoWorkspace";
import { notifyUser, requestReference } from "./notifications";
import { masterKey, open, seal } from "./secretBox";
import {
  BLOCK_REASONS, cardDigits, cardLabel, expiresSoon, expiryText, formatNumber, isExpired, luhnOk, NETWORK_NAME, networkOf, parseCard, REPORT_REASONS,
  type BlockReason, type CardInput, type CardNetworkKey, type ReportReason,
} from "./cardRules";
import type { DbTx } from "./uploads";

const MAX_CARDS = 5;
const NUMBER_FIELD = "payment_card.number";
const CVV_FIELD = "payment_card.cvv";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const usd = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function key() {
  const k = masterKey();
  if (!k.key) throw new Error(`Card details can't be stored: ${k.problem}`);
  return k.key;
}
/** Same number → same hash, for this server's key only. */
const hashNumber = (digits: string) => createHmac("sha256", createHmac("sha256", key()).update("payment-card-number-v1").digest()).update(digits).digest("hex");

/* ---------- flags: what an administrator should know before paying or charging a card ---------- */

export type CardFlag = { kind: "expired" | "expiring" | "reported" | "duplicate" | "blocked"; text: string };
type Context = { reported: Map<string, DemoReportedCard>; holders: Map<string, Set<string>> };

/** The open reports and who else saved each number, for the given cards. */
async function contextFor(cards: Pick<DemoPaymentCard, "numberHash">[], tx: Pick<typeof db, "select"> = db): Promise<Context> {
  const hashes = [...new Set(cards.map(c => c.numberHash))];
  if (!hashes.length) return { reported: new Map(), holders: new Map() };
  const reports = await tx.select().from(demoReportedCardsTable).where(and(inArray(demoReportedCardsTable.numberHash, hashes), isNull(demoReportedCardsTable.clearedAt)))
    .orderBy(desc(demoReportedCardsTable.createdAt));
  const reported = new Map<string, DemoReportedCard>();
  for (const r of reports) if (!reported.has(r.numberHash)) reported.set(r.numberHash, r);
  const others = await tx.select({ hash: demoPaymentCardsTable.numberHash, profileId: demoPaymentCardsTable.profileId }).from(demoPaymentCardsTable)
    .where(and(inArray(demoPaymentCardsTable.numberHash, hashes), ne(demoPaymentCardsTable.status, "Removed")));
  const holders = new Map<string, Set<string>>();
  for (const o of others) holders.set(o.hash, (holders.get(o.hash) ?? new Set()).add(o.profileId));
  return { reported, holders };
}

function flagsOf(c: DemoPaymentCard, ctx: Context, now = new Date()): CardFlag[] {
  const flags: CardFlag[] = [];
  if (c.status === "Blocked") flags.push({ kind: "blocked", text: `Blocked: ${c.blockReason ?? "Other"}${c.blockNote ? ` · ${c.blockNote}` : ""}` });
  const report = ctx.reported.get(c.numberHash);
  if (report) flags.push({ kind: "reported", text: `On the reported list: ${report.reason}${report.note ? ` · ${report.note}` : ""} (${report.createdAt.toISOString().slice(0, 10)})` });
  if (isExpired(c.expMonth, c.expYear, now)) flags.push({ kind: "expired", text: `Expired ${expiryText(c.expMonth, c.expYear)}` });
  else if (expiresSoon(c.expMonth, c.expYear, now)) flags.push({ kind: "expiring", text: `Expires ${expiryText(c.expMonth, c.expYear)}` });
  const others = [...(ctx.holders.get(c.numberHash) ?? [])].filter(p => p !== c.profileId).length;
  if (others > 0) flags.push({ kind: "duplicate", text: `Also saved on ${others} other account${others === 1 ? "" : "s"}` });
  return flags;
}

/** Why a card can't be used or paid right now (blocked, removed, reported, expired), or null. */
function unusable(c: DemoPaymentCard, ctx: Context, who: "applicant" | "admin"): string | null {
  const label = cardLabel(c);
  if (c.status === "Removed") return who === "applicant" ? `Your ${label} was removed. Choose another card.` : `The customer removed ${label}.`;
  if (c.status === "Blocked") return who === "applicant" ? `Your ${label} is blocked${c.blockNote ? `: ${c.blockNote}` : ""}. Contact support.` : `${label} is blocked (${c.blockReason ?? "Other"}). Unblock it first, or decline this request.`;
  const report = ctx.reported.get(c.numberHash);
  if (report) return who === "applicant" ? `Your ${label} can't be used. Contact support.` : `${label} is on the reported list (${report.reason}). Clear the report first, or decline this request.`;
  if (isExpired(c.expMonth, c.expYear)) return who === "applicant" ? `Your ${label} has expired. Add your new card.` : `${label} expired ${expiryText(c.expMonth, c.expYear)}.`;
  return null;
}

/* ---------- shapes ---------- */

const base = (c: DemoPaymentCard) => ({
  id: c.id, holderName: c.holderName, network: c.network as CardNetworkKey, networkName: NETWORK_NAME[c.network as CardNetworkKey] ?? "Card",
  lastFour: c.lastFour, expiry: expiryText(c.expMonth, c.expYear), status: c.status as "Active" | "Blocked" | "Removed",
  expired: isExpired(c.expMonth, c.expYear), createdAt: c.createdAt.toISOString(),
});

/** The customer's view: no flags about other accounts or the reported list, only what they can act on. */
const applicantCard = (c: DemoPaymentCard, ctx: Context) => ({
  ...base(c),
  usable: !unusable(c, ctx, "applicant"),
  ...(c.status === "Blocked" ? { blockedReason: c.blockNote || "Blocked by our team. Contact support." } : {}),
});

type CardStats = { requests: number; pending: number; depositedCents: number; withdrawnCents: number; lastUsedAt: Date | null };
async function statsFor(ids: string[]) {
  const out = new Map<string, CardStats>();
  if (!ids.length) return out;
  const rows = await db.select({
    id: demoRequestsTable.cardId,
    requests: sql<number>`count(*)::int`,
    pending: sql<number>`count(*) filter (where ${demoRequestsTable.status} = 'Pending')::int`,
    deposited: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}) filter (where ${demoRequestsTable.status} = 'Completed' and ${demoRequestsTable.kind} = 'Deposit'), 0)::bigint`,
    withdrawn: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}) filter (where ${demoRequestsTable.status} = 'Completed' and ${demoRequestsTable.kind} = 'Withdrawal'), 0)::bigint`,
    last: sql<string | null>`max(${demoRequestsTable.createdAt})`,
  }).from(demoRequestsTable).where(inArray(demoRequestsTable.cardId, ids)).groupBy(demoRequestsTable.cardId);
  for (const r of rows) out.set(r.id!, { requests: r.requests, pending: r.pending, depositedCents: Number(r.deposited), withdrawnCents: Number(r.withdrawn), lastUsedAt: r.last ? new Date(r.last) : null });
  return out;
}

const adminCard = (c: DemoPaymentCard, ctx: Context, p: { name: string; organization: string } | undefined, s: CardStats | undefined) => ({
  ...base(c),
  userId: c.profileId, userName: p?.name ?? "Unknown user", organization: p?.organization ?? "",
  flags: flagsOf(c, ctx),
  ...(c.blockReason ? { blockReason: c.blockReason } : {}), ...(c.blockNote ? { blockNote: c.blockNote } : {}),
  ...(c.reviewedBy ? { reviewedBy: c.reviewedBy } : {}), ...(c.reviewedAt ? { reviewedAt: c.reviewedAt.toISOString() } : {}),
  ...(c.removedAt ? { removedAt: c.removedAt.toISOString() } : {}),
  requestCount: s?.requests ?? 0, pendingRequests: s?.pending ?? 0,
  deposited: (s?.depositedCents ?? 0) / 100, withdrawn: (s?.withdrawnCents ?? 0) / 100,
  ...(s?.lastUsedAt ? { lastUsedAt: s.lastUsedAt.toISOString() } : {}),
});

/* ---------- the customer's own cards ---------- */

export async function listOwnCards(profileId: string) {
  const rows = await db.select().from(demoPaymentCardsTable)
    .where(and(eq(demoPaymentCardsTable.profileId, profileId), ne(demoPaymentCardsTable.status, "Removed"))).orderBy(asc(demoPaymentCardsTable.createdAt));
  const ctx = await contextFor(rows);
  return rows.map(c => applicantCard(c, ctx));
}

/**
 * Save a card. A number on the reported list is still saved (so administrators see the attempt) but blocked at once,
 * and the customer is told only that it can't be used.
 */
export async function saveCard(profileId: string, input: CardInput, actor: string) {
  const parsed = parseCard(input);
  if (typeof parsed === "string") throw new DemoInputError(parsed);
  const k = key();
  const numberHash = hashNumber(parsed.number);
  const row = await db.transaction(async tx => {
    const [profile] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId)).for("update");
    if (!profile) throw new Error(`Applicant ${profileId} is missing`);
    if (profile.status === "Frozen") throw new DemoInputError("Your account is frozen. Contact support to make changes.");
    const mine = await tx.select().from(demoPaymentCardsTable).where(and(eq(demoPaymentCardsTable.profileId, profileId), ne(demoPaymentCardsTable.status, "Removed")));
    if (mine.some(c => c.numberHash === numberHash)) throw new DemoInputError(`You've already saved ${cardLabel(parsed)}.`);
    if (mine.length >= MAX_CARDS) throw new DemoInputError(`You can save up to ${MAX_CARDS} cards. Remove one first.`);
    const [report] = await tx.select().from(demoReportedCardsTable).where(and(eq(demoReportedCardsTable.numberHash, numberHash), isNull(demoReportedCardsTable.clearedAt))).limit(1);
    const [created] = await tx.insert(demoPaymentCardsTable).values({
      profileId, holderName: parsed.holderName, network: parsed.network, lastFour: parsed.lastFour, numberHash,
      numberSealed: seal(parsed.number, NUMBER_FIELD, k), cvvSealed: seal(parsed.cvv, CVV_FIELD, k), expMonth: parsed.expMonth, expYear: parsed.expYear,
      ...(report ? { status: "Blocked", blockReason: report.reason === "Stolen" || report.reason === "Lost" || report.reason === "Expired" ? report.reason : "Other", blockNote: "This card can't be used. Contact support.", reviewedBy: "System (reported list)", reviewedAt: new Date() } : {}),
    }).returning();
    if (!report) {
      const label = cardLabel(parsed);
      await notifyUser(profileId, `Your ${label} was added. You can use it for deposits and withdrawals.`, "/payment-cards", tx, {
        kind: "card_added",
        data: { card: label, holderName: parsed.holderName, expiry: expiryText(parsed.expMonth, parsed.expYear),
          date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) },
      });
    }
    await tx.insert(demoAuditTable).values({ profileId, actor, action: `Payment card saved: ${cardLabel(parsed)} (${parsed.holderName}, expires ${expiryText(parsed.expMonth, parsed.expYear)})${report ? ` · blocked: on the reported list (${report.reason})` : ""}` });
    return created!;
  });
  const ctx = await contextFor([row]);
  return applicantCard(row, ctx);
}

/** The customer removes a card. Refused while a request made with it is still waiting. */
export async function removeOwnCard(profileId: string, cardId: string, actor: string) {
  if (!isUuid(cardId)) return false;
  return db.transaction(async tx => {
    const [c] = await tx.select().from(demoPaymentCardsTable).where(and(eq(demoPaymentCardsTable.id, cardId), eq(demoPaymentCardsTable.profileId, profileId))).for("update");
    if (!c || c.status === "Removed") return false;
    const [pending] = await tx.select({ n: sql<number>`count(*)::int` }).from(demoRequestsTable).where(and(eq(demoRequestsTable.cardId, cardId), eq(demoRequestsTable.status, "Pending")));
    if ((pending?.n ?? 0) > 0) throw new DemoInputError(`${cardLabel(c)} has a request waiting for review. You can remove it once that's decided.`);
    await tx.update(demoPaymentCardsTable).set({ status: "Removed", removedAt: new Date() }).where(eq(demoPaymentCardsTable.id, cardId));
    await tx.insert(demoAuditTable).values({ profileId, actor, action: `Payment card removed: ${cardLabel(c)}` });
    return true;
  });
}

/**
 * For a request through a card method (inside the request's transaction): the customer's card, locked, or a refusal.
 * Returns the card's label for the request's copy of the method.
 */
export async function cardForRequest(tx: DbTx, profileId: string, cardId: unknown) {
  if (typeof cardId !== "string" || !isUuid(cardId)) throw new DemoInputError("Choose one of your saved cards.");
  const [c] = await tx.select().from(demoPaymentCardsTable).where(and(eq(demoPaymentCardsTable.id, cardId), eq(demoPaymentCardsTable.profileId, profileId))).for("update");
  if (!c) throw new DemoInputError("Choose one of your saved cards.");
  const why = unusable(c, await contextFor([c], tx), "applicant");
  if (why) throw new DemoInputError(why);
  return { id: c.id, snapshot: { network: c.network, lastFour: c.lastFour, holderName: c.holderName, expiry: expiryText(c.expMonth, c.expYear) } };
}

/** At approval time (inside the approval's transaction): refuse to pay or charge a card that's blocked, removed, reported or expired. */
export async function checkCardForApproval(tx: DbTx, cardId: string | null) {
  if (!cardId) return;
  const [c] = await tx.select().from(demoPaymentCardsTable).where(eq(demoPaymentCardsTable.id, cardId));
  if (!c) throw new DemoInputError("The card this request was made with is missing.");
  const why = unusable(c, await contextFor([c], tx), "admin");
  if (why) throw new DemoInputError(why);
}

/** The card part of an admin's request view: the card, its flags, and whether it can be paid. */
export async function cardsForRequests(cardIds: (string | null)[]) {
  const ids = [...new Set(cardIds.filter((x): x is string => !!x))];
  const out = new Map<string, ReturnType<typeof requestCard>>();
  if (!ids.length) return out;
  const rows = await db.select().from(demoPaymentCardsTable).where(inArray(demoPaymentCardsTable.id, ids));
  const ctx = await contextFor(rows);
  for (const c of rows) out.set(c.id, requestCard(c, ctx));
  return out;
}
const requestCard = (c: DemoPaymentCard, ctx: Context) => {
  const blocker = unusable(c, ctx, "admin");
  return { ...base(c), flags: flagsOf(c, ctx), ...(blocker ? { blocker } : {}) };
};

/* ---------- administrators ---------- */

export type AdminCardFilter = "all" | "flagged" | "Active" | "Blocked" | "Removed";

export async function listAdminCards(filter: AdminCardFilter, q = "", userId?: string) {
  const conditions = [
    ...(userId ? [eq(demoPaymentCardsTable.profileId, userId)] : []),
    ...(filter === "Active" || filter === "Blocked" || filter === "Removed" ? [eq(demoPaymentCardsTable.status, filter)] : []),
    ...(filter === "flagged" || filter === "all" ? [ne(demoPaymentCardsTable.status, "Removed")] : []),
  ];
  const rows = await db.select({ c: demoPaymentCardsTable, name: demoProfilesTable.name, organization: demoProfilesTable.organization }).from(demoPaymentCardsTable)
    .leftJoin(demoProfilesTable, eq(demoProfilesTable.id, demoPaymentCardsTable.profileId))
    .where(conditions.length ? and(...conditions) : undefined).orderBy(desc(demoPaymentCardsTable.createdAt)).limit(500);
  const ctx = await contextFor(rows.map(r => r.c));
  const stats = await statsFor(rows.map(r => r.c.id));
  const needle = q.trim().toLowerCase();
  const digits = cardDigits(q);
  return rows
    .map(r => adminCard(r.c, ctx, r.name ? { name: r.name, organization: r.organization ?? "" } : undefined, stats.get(r.c.id)))
    .filter(c => filter !== "flagged" || c.flags.length > 0)
    .filter(c => !needle || c.userName.toLowerCase().includes(needle) || c.holderName.toLowerCase().includes(needle) || c.organization.toLowerCase().includes(needle)
      || (digits.length >= 4 && /^\d+$/.test(digits) && c.lastFour === digits.slice(-4)));
}

async function findCard(id: string) {
  if (!isUuid(id)) return undefined;
  const [row] = await db.select({ c: demoPaymentCardsTable, name: demoProfilesTable.name, organization: demoProfilesTable.organization }).from(demoPaymentCardsTable)
    .leftJoin(demoProfilesTable, eq(demoProfilesTable.id, demoPaymentCardsTable.profileId)).where(eq(demoPaymentCardsTable.id, id));
  return row;
}

export async function adminCardDetail(id: string) {
  const row = await findCard(id);
  if (!row) return undefined;
  const ctx = await contextFor([row.c]);
  const stats = await statsFor([row.c.id]);
  const requests = await db.select().from(demoRequestsTable).where(eq(demoRequestsTable.cardId, id)).orderBy(desc(demoRequestsTable.createdAt)).limit(50);
  // Other accounts holding the same card.
  const same = await db.select({ id: demoPaymentCardsTable.id, profileId: demoPaymentCardsTable.profileId, status: demoPaymentCardsTable.status, name: demoProfilesTable.name })
    .from(demoPaymentCardsTable).leftJoin(demoProfilesTable, eq(demoProfilesTable.id, demoPaymentCardsTable.profileId))
    .where(and(eq(demoPaymentCardsTable.numberHash, row.c.numberHash), ne(demoPaymentCardsTable.id, id)));
  const reports = await db.select().from(demoReportedCardsTable).where(eq(demoReportedCardsTable.numberHash, row.c.numberHash)).orderBy(desc(demoReportedCardsTable.createdAt));
  return {
    ...adminCard(row.c, ctx, row.name ? { name: row.name, organization: row.organization ?? "" } : undefined, stats.get(row.c.id)),
    requests: requests.map(r => ({
      id: r.id, reference: requestReference(r.id), kind: r.kind as "Deposit" | "Withdrawal", amount: r.amountCents / 100, fee: r.feeCents / 100,
      status: r.status as "Pending" | "Completed" | "Declined", createdAt: r.createdAt.toISOString(), ...(r.reviewNote ? { reviewNote: r.reviewNote } : {}),
    })),
    sameCard: same.map(s => ({ cardId: s.id, userId: s.profileId, userName: s.name ?? "Unknown user", status: s.status })),
    reports: reports.map(reportOut),
  };
}

/** The full number and CVV, for paying or charging the card. Every view is audited. */
export async function revealCard(id: string, actor: string) {
  const row = await findCard(id);
  if (!row) return undefined;
  const k = key();
  const number = open(row.c.numberSealed, NUMBER_FIELD, k);
  const cvv = open(row.c.cvvSealed, CVV_FIELD, k);
  await db.insert(demoAuditTable).values({ profileId: row.c.profileId, actor, action: `Viewed full card details of ${cardLabel(row.c)}` });
  return { id, number: formatNumber(number), cvv, holderName: row.c.holderName, expiry: expiryText(row.c.expMonth, row.c.expYear), networkName: NETWORK_NAME[row.c.network as CardNetworkKey] ?? "Card" };
}

export type CardDecision = { action: "block"; reason: string; note: string } | { action: "unblock" };

export async function decideCard(id: string, d: CardDecision, actor: string) {
  if (!isUuid(id)) return undefined;
  let reason: BlockReason | undefined;
  let note = "";
  if (d.action === "block") {
    if (!(BLOCK_REASONS as readonly string[]).includes(d.reason)) throw new DemoInputError("Choose why the card is blocked.");
    reason = d.reason as BlockReason;
    note = (d.note ?? "").trim().slice(0, 240);
    if (note.length < 5) throw new DemoInputError("Give the customer a reason of at least 5 characters.");
  }
  const found = await db.transaction(async tx => {
    const [c] = await tx.select().from(demoPaymentCardsTable).where(eq(demoPaymentCardsTable.id, id)).for("update");
    if (!c) return false;
    if (c.status === "Removed") throw new DemoInputError("The customer removed this card, so it can't be changed.");
    const label = cardLabel(c);
    const now = new Date();
    if (d.action === "block") {
      await tx.update(demoPaymentCardsTable).set({ status: "Blocked", blockReason: reason, blockNote: note, reviewedBy: actor, reviewedAt: now }).where(eq(demoPaymentCardsTable.id, id));
      await tx.insert(demoAuditTable).values({ profileId: c.profileId, actor, action: `Payment card blocked: ${label} · ${reason} · ${note}` });
      await notifyUser(c.profileId, `Your ${label} was blocked: ${note}`, "/payment-cards", tx);
    } else {
      if (c.status !== "Blocked") throw new DemoInputError("This card isn't blocked.");
      await tx.update(demoPaymentCardsTable).set({ status: "Active", blockReason: null, blockNote: null, reviewedBy: actor, reviewedAt: now }).where(eq(demoPaymentCardsTable.id, id));
      await tx.insert(demoAuditTable).values({ profileId: c.profileId, actor, action: `Payment card unblocked: ${label}` });
      await notifyUser(c.profileId, `Your ${label} is unblocked and can be used again.`, "/payment-cards", tx);
    }
    return true;
  });
  return found ? adminCardDetail(id) : undefined;
}

/* ---------- the reported list ---------- */

const reportOut = (r: DemoReportedCard) => ({
  id: r.id, network: r.network as CardNetworkKey, networkName: NETWORK_NAME[r.network as CardNetworkKey] ?? "Card", lastFour: r.lastFour,
  reason: r.reason as ReportReason, note: r.note, reportedBy: r.reportedBy, createdAt: r.createdAt.toISOString(),
  ...(r.clearedAt ? { clearedAt: r.clearedAt.toISOString(), clearedBy: r.clearedBy ?? "" } : {}),
});

export async function listReported(includeCleared: boolean) {
  const rows = await db.select().from(demoReportedCardsTable).where(includeCleared ? undefined : isNull(demoReportedCardsTable.clearedAt))
    .orderBy(desc(demoReportedCardsTable.createdAt)).limit(500);
  // How many saved cards each report matches.
  const hashes = [...new Set(rows.map(r => r.numberHash))];
  const matches = hashes.length ? await db.select({ hash: demoPaymentCardsTable.numberHash, n: sql<number>`count(*)::int` }).from(demoPaymentCardsTable)
    .where(and(inArray(demoPaymentCardsTable.numberHash, hashes), ne(demoPaymentCardsTable.status, "Removed"))).groupBy(demoPaymentCardsTable.numberHash) : [];
  const n = new Map(matches.map(m => [m.hash, m.n]));
  return rows.map(r => ({ ...reportOut(r), matchingCards: n.get(r.numberHash) ?? 0 }));
}

/**
 * Report a card, from its full number (e.g. a customer called) or from a saved card. Saved cards with that number aren't
 * changed: they're flagged, and can't be used or paid until the report is cleared (blocking them is a separate choice).
 */
export async function reportCard(input: { number?: unknown; cardId?: unknown; reason?: unknown; note?: unknown }, actor: string) {
  if (typeof input.reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(input.reason)) throw new DemoInputError("Choose why the card is reported.");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 240) : "";
  let hash: string; let network: CardNetworkKey; let lastFour: string; let profileId: string | null = null;
  if (typeof input.cardId === "string" && input.cardId) {
    const row = await findCard(input.cardId);
    if (!row) throw new DemoInputError("Card not found.");
    hash = row.c.numberHash; network = row.c.network as CardNetworkKey; lastFour = row.c.lastFour; profileId = row.c.profileId;
  } else {
    const digits = cardDigits(input.number);
    if (!/^\d{12,19}$/.test(digits) || !luhnOk(digits)) throw new DemoInputError("Enter the full card number (12 to 19 digits) as printed on the card.");
    hash = hashNumber(digits); network = networkOf(digits); lastFour = digits.slice(-4);
  }
  const [open_] = await db.select().from(demoReportedCardsTable).where(and(eq(demoReportedCardsTable.numberHash, hash), isNull(demoReportedCardsTable.clearedAt))).limit(1);
  if (open_) throw new DemoInputError(`${cardLabel({ network, lastFour })} is already on the reported list (${open_.reason}).`);
  const [row] = await db.transaction(async tx => {
    const created = await tx.insert(demoReportedCardsTable).values({ numberHash: hash, network, lastFour, reason: input.reason as string, note, reportedBy: actor }).returning();
    await tx.insert(demoAuditTable).values({ profileId, actor, action: `Card reported ${String(input.reason).toLowerCase()}: ${cardLabel({ network, lastFour })}${note ? ` · ${note}` : ""}` });
    return created;
  });
  return reportOut(row!);
}

export async function clearReport(id: string, actor: string) {
  if (!isUuid(id)) return undefined;
  return db.transaction(async tx => {
    const [r] = await tx.select().from(demoReportedCardsTable).where(eq(demoReportedCardsTable.id, id)).for("update");
    if (!r) return undefined;
    if (r.clearedAt) throw new DemoInputError("This report was already cleared.");
    const [next] = await tx.update(demoReportedCardsTable).set({ clearedAt: new Date(), clearedBy: actor }).where(eq(demoReportedCardsTable.id, id)).returning();
    await tx.insert(demoAuditTable).values({ actor, action: `Card report cleared: ${cardLabel(r)} (${r.reason})` });
    return reportOut(next!);
  });
}

/* ---------- the overview: how card payments are doing ---------- */

export async function cardPaymentsOverview() {
  const cards = await db.select().from(demoPaymentCardsTable).where(ne(demoPaymentCardsTable.status, "Removed"));
  const ctx = await contextFor(cards);
  const flagged = cards.map(c => flagsOf(c, ctx)).filter(f => f.length > 0);
  const count = (s: string) => cards.filter(c => c.status === s).length;
  const byNetwork = Object.entries(cards.reduce<Record<string, number>>((m, c) => ({ ...m, [c.network]: (m[c.network] ?? 0) + 1 }), {}))
    .map(([network, n]) => ({ network: network as CardNetworkKey, networkName: NETWORK_NAME[network as CardNetworkKey] ?? "Card", count: n })).sort((a, b) => b.count - a.count);

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)));
  const viaCard = sql`${demoRequestsTable.cardId} is not null`;
  const [totals] = await db.select({
    pendingDeposits: sql<number>`count(*) filter (where ${demoRequestsTable.status} = 'Pending' and ${demoRequestsTable.kind} = 'Deposit')::int`,
    pendingDepositCents: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}) filter (where ${demoRequestsTable.status} = 'Pending' and ${demoRequestsTable.kind} = 'Deposit'), 0)::bigint`,
    pendingWithdrawals: sql<number>`count(*) filter (where ${demoRequestsTable.status} = 'Pending' and ${demoRequestsTable.kind} = 'Withdrawal')::int`,
    pendingWithdrawalCents: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}) filter (where ${demoRequestsTable.status} = 'Pending' and ${demoRequestsTable.kind} = 'Withdrawal'), 0)::bigint`,
    depositedMonth: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}) filter (where ${demoRequestsTable.status} = 'Completed' and ${demoRequestsTable.kind} = 'Deposit' and ${demoRequestsTable.reviewedAt} >= ${monthStart.toISOString()}), 0)::bigint`,
    withdrawnMonth: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}) filter (where ${demoRequestsTable.status} = 'Completed' and ${demoRequestsTable.kind} = 'Withdrawal' and ${demoRequestsTable.reviewedAt} >= ${monthStart.toISOString()}), 0)::bigint`,
    depositedAll: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}) filter (where ${demoRequestsTable.status} = 'Completed' and ${demoRequestsTable.kind} = 'Deposit'), 0)::bigint`,
    withdrawnAll: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}) filter (where ${demoRequestsTable.status} = 'Completed' and ${demoRequestsTable.kind} = 'Withdrawal'), 0)::bigint`,
    feesAll: sql<number>`coalesce(sum(${demoRequestsTable.feeCents}) filter (where ${demoRequestsTable.status} = 'Completed'), 0)::bigint`,
    completed: sql<number>`count(*) filter (where ${demoRequestsTable.status} = 'Completed')::int`,
    declined: sql<number>`count(*) filter (where ${demoRequestsTable.status} = 'Declined')::int`,
  }).from(demoRequestsTable).where(viaCard);
  const monthly = await db.select({
    month: sql<string>`to_char(date_trunc('month', ${demoRequestsTable.reviewedAt} at time zone 'UTC'), 'YYYY-MM')`,
    deposits: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}) filter (where ${demoRequestsTable.kind} = 'Deposit'), 0)::bigint`,
    withdrawals: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}) filter (where ${demoRequestsTable.kind} = 'Withdrawal'), 0)::bigint`,
  }).from(demoRequestsTable).where(and(viaCard, eq(demoRequestsTable.status, "Completed"), gte(demoRequestsTable.reviewedAt, months[0]!))).groupBy(sql`1`);
  const methods = await db.select({ id: demoPaymentMethodsTable.id, kind: demoPaymentMethodsTable.kind, name: demoPaymentMethodsTable.name, enabled: demoPaymentMethodsTable.enabled })
    .from(demoPaymentMethodsTable).where(eq(demoPaymentMethodsTable.methodType, "card")).orderBy(asc(demoPaymentMethodsTable.sortOrder));
  const recent = await db.select({ r: demoRequestsTable, name: demoProfilesTable.name }).from(demoRequestsTable)
    .leftJoin(demoProfilesTable, eq(demoProfilesTable.id, demoRequestsTable.profileId)).where(viaCard).orderBy(desc(demoRequestsTable.createdAt)).limit(8);
  const [reportedOpen] = await db.select({ n: sql<number>`count(*)::int` }).from(demoReportedCardsTable).where(isNull(demoReportedCardsTable.clearedAt));
  const decided = (totals?.completed ?? 0) + (totals?.declined ?? 0);
  const $ = (v: number | undefined) => Number(v ?? 0) / 100;
  return {
    cards: { total: cards.length, active: count("Active"), blocked: count("Blocked"), flagged: flagged.length,
      expired: cards.filter(c => isExpired(c.expMonth, c.expYear)).length, reported: cards.filter(c => ctx.reported.has(c.numberHash)).length,
      customers: new Set(cards.map(c => c.profileId)).size },
    reportedOpen: reportedOpen?.n ?? 0,
    pending: { deposits: totals?.pendingDeposits ?? 0, depositAmount: $(totals?.pendingDepositCents), withdrawals: totals?.pendingWithdrawals ?? 0, withdrawalAmount: $(totals?.pendingWithdrawalCents) },
    thisMonth: { deposited: $(totals?.depositedMonth), withdrawn: $(totals?.withdrawnMonth) },
    allTime: { deposited: $(totals?.depositedAll), withdrawn: $(totals?.withdrawnAll), fees: $(totals?.feesAll), approved: totals?.completed ?? 0, declined: totals?.declined ?? 0,
      approvalRate: decided ? Math.round(((totals?.completed ?? 0) / decided) * 100) : null },
    trend: months.map(m => {
      const k = m.toISOString().slice(0, 7);
      const row = monthly.find(r => r.month === k);
      return { label: m.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), deposits: $(row?.deposits), withdrawals: $(row?.withdrawals) };
    }),
    byNetwork,
    methods: methods.map(m => ({ id: m.id, kind: m.kind as "Deposit" | "Withdrawal", name: m.name, enabled: m.enabled })),
    recent: recent.map(({ r, name }) => ({
      id: r.id, reference: requestReference(r.id), kind: r.kind as "Deposit" | "Withdrawal", amount: r.amountCents / 100, status: r.status as "Pending" | "Completed" | "Declined",
      createdAt: r.createdAt.toISOString(), userId: r.profileId, userName: name ?? "Unknown user",
      card: (() => { const s = (r.methodSnapshot as { card?: { network: string; lastFour: string } } | null)?.card; return s ? cardLabel(s) : "Card"; })(),
    })),
  };
}


