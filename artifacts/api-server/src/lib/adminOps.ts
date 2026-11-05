import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import {
  db, demoProfilesTable, demoGrantPlansTable, demoAuditTable, demoLedgerTable, demoSettingsTable, demoRequestsTable, demoApplicationsTable,
  demoApplicationEventsTable, demoFilesTable, demoKycDocumentsTable, type DemoProfile,
} from "@workspace/db";
import { notifyUser, requestEmailData, requestReference } from "./notifications";
import { applicationSummary } from "./applicantRecords";
import { KYC_KINDS } from "./kyc";
import { fileUrl, type DbTx } from "./uploads";
import { DemoInputError, getUser, methodLogos, requestDetails, type LogoMap } from "./demoWorkspace";
import { sourceAllowed, SOURCE_LABEL, SOURCES_LABEL, type BalanceSource, type WithdrawalSources } from "./paymentRules";
import { looseDocuments, planParts } from "./planAnswers";
import { describeLimits, effectiveLimits, limitsOut, parseLimits, withdrawnLast24h, type Limits } from "./withdrawalLimits";

/*
 * Administrator actions on what applicants submit. Every action that moves money locks rows in the same
 * order as the applicant side (platform settings → profile → the record itself), writes the ledger, the
 * audit log and a notification in one transaction, and is refused while the platform or account is frozen.
 */

const usd = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const like = (q: string) => `%${q.trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const MAX_BALANCE_CENTS = 2000000000;

async function lockPlatform(tx: DbTx) {
  const [s] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
  return s?.frozen ?? false;
}
async function lockProfile(tx: DbTx, id: string) {
  const [p] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, id)).for("update");
  return p;
}
type Perms = { withdrawalKycRequired?: boolean; depositKycRequired?: boolean };

/* ---------- applications ---------- */

type AppRow = typeof demoApplicationsTable.$inferSelect;
export const DECISIONS = ["Review", "Approved", "Declined", "Changes requested"] as const;
export type Decision = (typeof DECISIONS)[number];
/** Which decisions each status allows. "Changes requested" waits for the applicant to resubmit. */
const NEXT: Record<string, readonly Decision[]> = {
  Submitted: DECISIONS,
  Review: ["Approved", "Declined", "Changes requested"],
};
const statusWords = (s: string) => (s === "Review" ? "under review" : s.toLowerCase());

const adminApplication = (a: AppRow, p: { name: string; organization: string }) => ({
  ...applicationSummary(a), userId: a.profileId, userName: p.name, organization: p.organization,
});

export async function listAdminApplications(status: "pending" | "all", userId?: string) {
  const terms: SQL[] = [];
  if (status === "pending") terms.push(inArray(demoApplicationsTable.status, ["Submitted", "Review"]));
  if (userId) terms.push(eq(demoApplicationsTable.profileId, userId));
  const rows = await db.select({ a: demoApplicationsTable, name: demoProfilesTable.name, organization: demoProfilesTable.organization })
    .from(demoApplicationsTable).innerJoin(demoProfilesTable, eq(demoProfilesTable.id, demoApplicationsTable.profileId))
    .where(and(...terms))
    // The review queue is first come, first served; everything else is newest first.
    .orderBy(status === "pending" ? asc(demoApplicationsTable.submittedAt) : desc(demoApplicationsTable.submittedAt)).limit(200);
  return rows.map(r => adminApplication(r.a, r));
}

export async function adminApplicationDetail(id: string) {
  const [r] = await db.select({ a: demoApplicationsTable, p: demoProfilesTable })
    .from(demoApplicationsTable).innerJoin(demoProfilesTable, eq(demoProfilesTable.id, demoApplicationsTable.profileId))
    .where(eq(demoApplicationsTable.id, id));
  if (!r) return undefined;
  const events = await db.select().from(demoApplicationEventsTable).where(eq(demoApplicationEventsTable.applicationId, id)).orderBy(asc(demoApplicationEventsTable.createdAt));
  const files = await db.select().from(demoFilesTable).where(eq(demoFilesTable.applicationId, id)).orderBy(asc(demoFilesTable.createdAt));
  const [settings] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  const [plan] = r.a.planId ? await db.select({ logoFileId: demoGrantPlansTable.logoFileId }).from(demoGrantPlansTable).where(eq(demoGrantPlansTable.id, r.a.planId)) : [];
  return {
    ...adminApplication(r.a, r.p),
    updatedAt: r.a.updatedAt.toISOString(),
    userStatus: r.p.status, platformFrozen: settings?.frozen ?? false,
    accountBalance: r.p.depositCents / 100,
    ...planParts(r.a, files, "admin", plan?.logoFileId),
    allowedDecisions: [...(NEXT[r.a.status] ?? [])],
    documents: looseDocuments(files).map(f => ({ id: f.id, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, url: fileUrl("admin", f.id), uploadedAt: f.createdAt.toISOString() })),
    events: events.map(e => ({ id: e.id, status: e.status, note: e.note, actor: e.actor, createdAt: e.createdAt.toISOString() })),
  };
}

/**
 * Approving credits the award to the applicant's grant balance through the ledger. For a grant plan application
 * (Phase 11) it also charges the application fee from the account balance in the same step: the one charge that may
 * take that balance below $0.
 */
export async function decideApplication(id: string, decision: Decision, note: string | undefined, actor: string) {
  const text = (note ?? "").trim();
  if (decision === "Declined" && text.length < 5) throw new DemoInputError("Give the applicant a reason of at least 5 characters.");
  if (decision === "Changes requested" && text.length < 5) throw new DemoInputError("Describe the changes needed in at least 5 characters.");
  const found = await db.transaction(async tx => {
    const [peek] = await tx.select({ profileId: demoApplicationsTable.profileId }).from(demoApplicationsTable).where(eq(demoApplicationsTable.id, id));
    if (!peek) return false;
    const frozen = await lockPlatform(tx);
    const profile = await lockProfile(tx, peek.profileId);
    const [a] = await tx.select().from(demoApplicationsTable).where(eq(demoApplicationsTable.id, id)).for("update");
    if (!a || !profile) return false;
    if (!(NEXT[a.status] ?? []).includes(decision)) {
      throw new DemoInputError(`An application that is ${statusWords(a.status)} can't be moved to ${statusWords(decision)}.`);
    }
    let eventNote = text;
    if (decision === "Approved") {
      if (frozen) throw new DemoInputError("Approvals that release funds are paused by the global freeze.");
      if (profile.status === "Frozen") throw new DemoInputError("Unfreeze this account before approving funding.");
      const next = profile.grantCents + a.amountCents;
      if (next > MAX_BALANCE_CENTS) throw new DemoInputError("This would exceed the demo account limit.");
      const fee = a.feeCents;
      await tx.update(demoProfilesTable).set({ grantCents: next, ...(fee > 0 ? { depositCents: profile.depositCents - fee } : {}) }).where(eq(demoProfilesTable.id, profile.id));
      await tx.insert(demoLedgerTable).values({
        profileId: profile.id, kind: "Grant award", account: "grant", amountCents: a.amountCents, reason: `Grant award · ${a.title}`, applicationId: a.id, actor,
      });
      if (fee > 0) {
        await tx.insert(demoLedgerTable).values({
          profileId: profile.id, kind: "Application fee", account: "deposit", amountCents: -fee, reason: `Application fee · ${a.title}`, applicationId: a.id, actor,
        });
      }
      eventNote = `Funding of ${usd(a.amountCents)} approved${fee > 0 ? `; application fee ${usd(fee)} charged from the account balance` : ""}${text ? `. ${text}` : ""}`;
    } else if (decision === "Review") {
      eventNote = text || "Moved to review";
    }
    await tx.update(demoApplicationsTable).set({ status: decision, updatedAt: new Date() }).where(eq(demoApplicationsTable.id, id));
    await tx.insert(demoApplicationEventsTable).values({ applicationId: id, status: decision, note: eventNote, actor });
    await tx.insert(demoAuditTable).values({ profileId: profile.id, actor, action: `Application ${id} ${decision === "Review" ? "moved to review" : statusWords(decision)}${decision === "Approved" && a.feeCents > 0 ? ` (application fee ${usd(a.feeCents)})` : ""}` });
    const message = {
      Review: `"${a.title}" is now under review`,
      Approved: `"${a.title}" was approved. ${usd(a.amountCents)} was added to your grant balance${a.feeCents > 0 ? ` and the ${usd(a.feeCents)} application fee was charged from your account balance` : ""}`,
      Declined: `"${a.title}" was declined`,
      "Changes requested": `Changes were requested on "${a.title}"`,
    }[decision];
    await notifyUser(profile.id, message, `/applications/${id}`, tx);
    return true;
  });
  return found ? adminApplicationDetail(id) : undefined;
}

/* ---------- deposit and withdrawal requests ---------- */

type RequestRow = typeof demoRequestsTable.$inferSelect;
const adminRequest = (r: RequestRow, p: DemoProfile, logos: LogoMap = new Map()) => {
  const perms = (p.permissions ?? {}) as Perms;
  return {
    ...requestDetails(r, "admin", logos),
    withdrawalSources: p.withdrawalSources as WithdrawalSources,
    id: r.id, reference: requestReference(r.id), kind: r.kind as "Deposit" | "Withdrawal", amount: r.amountCents / 100, note: r.note, status: r.status as "Pending" | "Completed" | "Declined",
    createdAt: r.createdAt.toISOString(),
    userId: p.id, userName: p.name, organization: p.organization, userStatus: p.status, verificationLevel: p.verificationLevel,
    kycRequired: !!(r.kind === "Withdrawal" ? perms.withdrawalKycRequired : perms.depositKycRequired),
    grantBalance: p.grantCents / 100, depositBalance: p.depositCents / 100,
    fee: r.feeCents / 100, net: (r.kind === "Deposit" ? r.amountCents - r.feeCents : r.amountCents + r.feeCents) / 100,
    ...(r.reviewNote ? { reviewNote: r.reviewNote } : {}),
    ...(r.reviewedBy ? { reviewedBy: r.reviewedBy } : {}),
    ...(r.reviewedAt ? { reviewedAt: r.reviewedAt.toISOString() } : {}),
  };
};

export async function listAdminRequests(kind: "Deposit" | "Withdrawal", status: "pending" | "decided") {
  const pending = status === "pending";
  const rows = await db.select({ r: demoRequestsTable, p: demoProfilesTable })
    .from(demoRequestsTable).innerJoin(demoProfilesTable, eq(demoProfilesTable.id, demoRequestsTable.profileId))
    .where(and(eq(demoRequestsTable.kind, kind), pending ? eq(demoRequestsTable.status, "Pending") : ne(demoRequestsTable.status, "Pending")))
    .orderBy(pending ? asc(demoRequestsTable.createdAt) : desc(demoRequestsTable.reviewedAt)).limit(pending ? 200 : 30);
  const logos = await methodLogos(rows.map(({ r }) => r.methodId), "admin");
  if (!pending || kind !== "Withdrawal") return rows.map(({ r, p }) => adminRequest(r, p, logos));
  // Limits are checked when a request is placed; flag any that the user's *current* limits wouldn't allow (e.g. lowered since).
  const [settings] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  const used = await withdrawnLast24h([...new Set(rows.map(({ p }) => p.id))]);
  return rows.map(({ r, p }) => {
    const warning = limitWarning(effectiveLimits(p, settings), used.get(p.id) ?? 0, r.amountCents);
    return { ...adminRequest(r, p, logos), ...(warning ? { limitWarning: warning } : {}) };
  });
}

function limitWarning(l: Limits, usedCents: number, amountCents: number) {
  if (l.maxCents !== null && amountCents > l.maxCents) return `Above this user's current limit of ${usd(l.maxCents)} per request.`;
  if (l.dailyCents !== null && usedCents > l.dailyCents) return `This user's withdrawals in the last 24 hours (${usd(usedCents)}) are above their daily limit of ${usd(l.dailyCents)}.`;
  return undefined;
}

/* ---------- withdrawal limits ---------- */

export async function globalWithdrawalLimits() {
  const [settings] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  return limitsOut({ maxCents: settings?.withdrawalMaxCents ?? null, dailyCents: settings?.withdrawalDailyCents ?? null });
}

export async function changeGlobalWithdrawalLimits(input: { maxPerRequest: number | null; dailyTotal: number | null }, actor: string) {
  const limits = parseLimits(input);
  if (typeof limits === "string") throw new DemoInputError(limits);
  await db.transaction(async tx => {
    const [before] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    if (before?.withdrawalMaxCents === limits.maxCents && before?.withdrawalDailyCents === limits.dailyCents) return;
    await tx.update(demoSettingsTable).set({ withdrawalMaxCents: limits.maxCents, withdrawalDailyCents: limits.dailyCents }).where(eq(demoSettingsTable.id, "platform"));
    await tx.insert(demoAuditTable).values({ actor, action: `Global withdrawal limits set: ${describeLimits(limits)}` });
  });
  return limitsOut(limits);
}

/** custom = false: the user follows the global limits. custom = true: the given limits replace them (null = no limit). */
export async function changeUserWithdrawalLimits(id: string, input: { custom: boolean; maxPerRequest?: number | null; dailyTotal?: number | null }, actor: string) {
  const limits = input.custom ? parseLimits(input) : { maxCents: null, dailyCents: null };
  if (typeof limits === "string") throw new DemoInputError(limits);
  const found = await db.transaction(async tx => {
    const [settings] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
    const profile = await lockProfile(tx, id);
    if (!profile) return false;
    const next = { withdrawalLimitCustom: input.custom, withdrawalMaxCents: limits.maxCents, withdrawalDailyCents: limits.dailyCents };
    if (profile.withdrawalLimitCustom === next.withdrawalLimitCustom && profile.withdrawalMaxCents === next.withdrawalMaxCents && profile.withdrawalDailyCents === next.withdrawalDailyCents) return true;
    await tx.update(demoProfilesTable).set(next).where(eq(demoProfilesTable.id, id));
    const effective = effectiveLimits(next, settings);
    await tx.insert(demoAuditTable).values({ profileId: id, actor, action: input.custom ? `Custom withdrawal limits set: ${describeLimits(limits)}` : "Withdrawal limits set to follow the global limits" });
    await notifyUser(id, `Your withdrawal limits have changed: ${describeLimits(effective)}.`, "/withdrawals", tx);
    return true;
  });
  return found ? getUser(id) : undefined;
}

/** Which balances a user can withdraw from (grant / deposit / both). Pending withdrawals from a balance closed here can't be approved. */
export async function changeUserWithdrawalSources(id: string, sources: WithdrawalSources, actor: string) {
  const found = await db.transaction(async tx => {
    const profile = await lockProfile(tx, id);
    if (!profile) return false;
    if (profile.withdrawalSources === sources) return true;
    await tx.update(demoProfilesTable).set({ withdrawalSources: sources }).where(eq(demoProfilesTable.id, id));
    await tx.insert(demoAuditTable).values({ profileId: id, actor, action: `Withdrawals allowed from: ${SOURCES_LABEL[sources]}` });
    await notifyUser(id, `You can now withdraw from your ${SOURCES_LABEL[sources]}.`, "/withdrawals", tx);
    return true;
  });
  return found ? getUser(id) : undefined;
}

/** Lock a request together with its owner, in the standard order. */
async function lockRequest(tx: DbTx, id: string) {
  if (!isUuid(id)) return undefined;
  const [peek] = await tx.select({ profileId: demoRequestsTable.profileId }).from(demoRequestsTable).where(eq(demoRequestsTable.id, id));
  if (!peek) return undefined;
  const frozen = await lockPlatform(tx);
  const profile = await lockProfile(tx, peek.profileId);
  const [request] = await tx.select().from(demoRequestsTable).where(eq(demoRequestsTable.id, id)).for("update");
  if (!request || !profile) return undefined;
  if (request.status !== "Pending") throw new DemoInputError(`This request was already ${request.status === "Completed" ? "approved" : "declined"}.`);
  return { frozen, profile, request };
}

/**
 * A deposit credits the account balance; a withdrawal is paid out of the balance the applicant chose (grant or deposit),
 * which must still be open to them. `note` (optional, up to 240 characters) is shown to the applicant.
 */
export async function approveRequest(id: string, actor: string, note?: string) {
  const message = (note ?? "").trim();
  if (message.length > 240) throw new DemoInputError("Keep the note to 240 characters or fewer.");
  return db.transaction(async tx => {
    const locked = await lockRequest(tx, id);
    if (!locked) return undefined;
    const { frozen, profile, request: r } = locked;
    if (frozen) throw new DemoInputError("Approvals are paused while the platform is frozen.");
    if (profile.status === "Frozen") throw new DemoInputError("Unfreeze this account before approving its requests.");
    const perms = (profile.permissions ?? {}) as Perms;
    const kycRequired = r.kind === "Withdrawal" ? perms.withdrawalKycRequired : perms.depositKycRequired;
    if (kycRequired && profile.verificationLevel !== "Verified") {
      throw new DemoInputError(`This user's settings require identity verification for ${r.kind.toLowerCase()}s, and they aren't verified.`);
    }
    const deposit = r.kind === "Deposit";
    const source: BalanceSource = deposit ? "deposit" : r.source === "deposit" ? "deposit" : "grant";
    // The fee was worked out when the request was placed (9.3): deposits lose it from the amount, withdrawals pay it from the account balance.
    const fee = r.feeCents;
    let change: Partial<DemoProfile>;
    if (deposit) {
      const next = profile.depositCents + r.amountCents - fee;
      if (next > MAX_BALANCE_CENTS) throw new DemoInputError("This would exceed the demo account limit.");
      change = { depositCents: next };
    } else {
      if (!sourceAllowed(profile.withdrawalSources, source)) {
        throw new DemoInputError(`Withdrawals from the ${SOURCE_LABEL[source]} are closed for this user. Open them in the user's profile, or decline this request.`);
      }
      if (source === "deposit") {
        if (profile.depositCents < r.amountCents + fee) {
          throw new DemoInputError(`The account balance (${usd(profile.depositCents)}) is less than this withdrawal${fee ? ` and its ${usd(fee)} fee (${usd(r.amountCents + fee)})` : ""}.`);
        }
        change = { depositCents: profile.depositCents - r.amountCents - fee };
      } else {
        if (profile.grantCents < r.amountCents) throw new DemoInputError(`The grant balance (${usd(profile.grantCents)}) is less than this withdrawal.`);
        if (profile.depositCents < fee) throw new DemoInputError(`The ${usd(fee)} fee is paid from the account balance, which has only ${usd(profile.depositCents)}.`);
        change = { grantCents: profile.grantCents - r.amountCents, ...(fee ? { depositCents: profile.depositCents - fee } : {}) };
      }
    }
    const reviewedAt = new Date();
    const methodName = (r.methodSnapshot as { name?: string } | null)?.name;
    await tx.update(demoProfilesTable).set(change).where(eq(demoProfilesTable.id, profile.id));
    await tx.update(demoRequestsTable).set({ status: "Completed", reviewedAt, reviewedBy: actor, reviewNote: message || null }).where(eq(demoRequestsTable.id, r.id));
    await tx.insert(demoLedgerTable).values({
      profileId: profile.id, kind: r.kind, account: source, amountCents: deposit ? r.amountCents : -r.amountCents,
      reason: r.note || `${r.kind}${methodName ? ` via ${methodName}` : " request"} approved`, requestId: r.id, actor,
    });
    if (fee > 0) {
      await tx.insert(demoLedgerTable).values({
        profileId: profile.id, kind: "Fee", account: "deposit", amountCents: -fee, reason: `${r.kind} fee${methodName ? ` · ${methodName}` : ""}`, requestId: r.id, actor,
      });
    }
    await tx.insert(demoAuditTable).values({ profileId: profile.id, actor, action: `${r.kind} request ${r.id.slice(0, 8)} approved ${deposit ? "+" : "−"}${usd(r.amountCents)}${deposit ? "" : ` from the ${SOURCE_LABEL[source]}`}${fee ? `, fee ${usd(fee)}` : ""}${message ? ` · ${message}` : ""}` });
    await notifyUser(profile.id, deposit
      ? `Your deposit of ${usd(r.amountCents)} (ref ${requestReference(r.id)}) was approved${fee ? `: ${usd(r.amountCents - fee)} was added to your account balance after the ${usd(fee)} fee` : " and added to your account balance"}${message ? `. Note: ${message}` : ""}`
      : `Your withdrawal of ${usd(r.amountCents)} (ref ${requestReference(r.id)}) was approved. Your funds have been released from your ${SOURCE_LABEL[source]}${fee ? `; the ${usd(fee)} fee was paid from your account balance` : ""}${message ? `. Note: ${message}` : "."}`,
    deposit ? "/deposits" : "/withdrawals", tx, { kind: "request_approved", data: requestEmailData(r, message || undefined) });
    const logos = await methodLogos([r.methodId], "admin");
    return adminRequest({ ...r, status: "Completed", reviewedAt, reviewedBy: actor, reviewNote: message || null }, { ...profile, ...change }, logos);
  });
}

/** Declining moves no money, so it is allowed during a freeze. */
export async function rejectRequest(id: string, reason: string, actor: string) {
  const note = reason.trim();
  if (note.length < 5) throw new DemoInputError("Give the applicant a reason of at least 5 characters.");
  return db.transaction(async tx => {
    const locked = await lockRequest(tx, id);
    if (!locked) return undefined;
    const { profile, request: r } = locked;
    const reviewedAt = new Date();
    await tx.update(demoRequestsTable).set({ status: "Declined", reviewNote: note, reviewedAt, reviewedBy: actor }).where(eq(demoRequestsTable.id, r.id));
    await tx.insert(demoAuditTable).values({ profileId: profile.id, actor, action: `${r.kind} request ${r.id.slice(0, 8)} declined · ${note}` });
    await notifyUser(profile.id, `Your ${r.kind.toLowerCase()} request of ${usd(r.amountCents)} (ref ${requestReference(r.id)}) was declined: ${note}`,
      r.kind === "Deposit" ? "/deposits" : "/withdrawals", tx, { kind: "request_declined", data: requestEmailData(r, note) });
    return adminRequest({ ...r, status: "Declined", reviewNote: note, reviewedAt, reviewedBy: actor }, profile, await methodLogos([r.methodId], "admin"));
  });
}

/* ---------- ledger ---------- */

export const LEDGER_PAGE_SIZE = 25;
export type LedgerFilters = { type: string; userId?: string; from?: string; to?: string; search?: string };
type LedgerRow = typeof demoLedgerTable.$inferSelect;

const ledgerEntry = (l: LedgerRow, userName: string) => ({
  id: l.id, createdAt: l.createdAt.toISOString(), userId: l.profileId, userName,
  kind: l.kind as "Top-up" | "Debit" | "Deposit" | "Withdrawal" | "Grant award" | "Opening balance" | "Fee" | "Card purchase" | "Card top-up" | "Application fee",
  account: l.account as "grant" | "deposit" | "card", amount: l.amountCents / 100, reason: l.reason, actor: l.actor,
  ...(l.requestId ? { requestId: l.requestId } : {}),
  ...(l.applicationId ? { applicationId: l.applicationId } : {}),
});

/** Start of a YYYY-MM-DD day in UTC; refuses dates that don't exist (e.g. 2026-02-31). */
function dayStart(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) throw new DemoInputError(`${day} isn't a valid date.`);
  return d;
}
/** Whole-day UTC range filter on a timestamp column; `to` is inclusive. */
function dayRange(column: typeof demoLedgerTable.createdAt | typeof demoAuditTable.createdAt, from?: string, to?: string): SQL[] {
  return [
    ...(from ? [gte(column, dayStart(from))] : []),
    ...(to ? [lt(column, new Date(dayStart(to).getTime() + 86400000))] : []),
  ];
}

/** Date filters are whole days in UTC; `to` is inclusive. */
function ledgerWhere(f: LedgerFilters) {
  const terms: SQL[] = [];
  if (f.type !== "all") terms.push(eq(demoLedgerTable.kind, f.type));
  if (f.userId) terms.push(eq(demoLedgerTable.profileId, f.userId));
  terms.push(...dayRange(demoLedgerTable.createdAt, f.from, f.to));
  if (f.search?.trim()) {
    const t = like(f.search);
    terms.push(or(
      ilike(sql`${demoLedgerTable.id}::text`, t), ilike(sql`coalesce(${demoLedgerTable.requestId}::text, '')`, t),
      ilike(sql`coalesce(${demoLedgerTable.applicationId}, '')`, t), ilike(demoLedgerTable.reason, t), ilike(demoProfilesTable.name, t),
    )!);
  }
  return and(...terms);
}

export async function listLedger(f: LedgerFilters, page: number) {
  const where = ledgerWhere(f);
  const rows = await db.select({ l: demoLedgerTable, name: demoProfilesTable.name })
    .from(demoLedgerTable).innerJoin(demoProfilesTable, eq(demoProfilesTable.id, demoLedgerTable.profileId))
    .where(where).orderBy(desc(demoLedgerTable.createdAt), desc(demoLedgerTable.id))
    .limit(LEDGER_PAGE_SIZE).offset((page - 1) * LEDGER_PAGE_SIZE);
  const [totals] = await db.select({
    n: sql<number>`count(*)::int`,
    inflow: sql<number>`coalesce(sum(${demoLedgerTable.amountCents}) filter (where ${demoLedgerTable.amountCents} > 0), 0)::bigint`,
    outflow: sql<number>`coalesce(-sum(${demoLedgerTable.amountCents}) filter (where ${demoLedgerTable.amountCents} < 0), 0)::bigint`,
  }).from(demoLedgerTable).innerJoin(demoProfilesTable, eq(demoProfilesTable.id, demoLedgerTable.profileId)).where(where);
  return {
    items: rows.map(r => ledgerEntry(r.l, r.name)),
    total: totals?.n ?? 0, page, pageSize: LEDGER_PAGE_SIZE,
    inflow: Number(totals?.inflow ?? 0) / 100, outflow: Number(totals?.outflow ?? 0) / 100,
  };
}

/** Quote a CSV cell; text that a spreadsheet would run as a formula is prefixed with an apostrophe. */
const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;

export async function exportLedgerCsv(f: LedgerFilters) {
  const rows = await db.select({ l: demoLedgerTable, name: demoProfilesTable.name })
    .from(demoLedgerTable).innerJoin(demoProfilesTable, eq(demoProfilesTable.id, demoLedgerTable.profileId))
    .where(ledgerWhere(f)).orderBy(desc(demoLedgerTable.createdAt), desc(demoLedgerTable.id)).limit(10000);
  const header = ["Entry ID", "Date (UTC)", "User ID", "User", "Type", "Account", "Amount (USD)", "Reason", "Recorded by", "Request ID", "Application ID"];
  const lines = rows.map(({ l, name }) => [
    cell(l.id), cell(l.createdAt.toISOString()), cell(l.profileId), cell(name), cell(l.kind), cell(l.account),
    (l.amountCents / 100).toFixed(2), cell(l.reason), cell(l.actor), cell(l.requestId ?? ""), cell(l.applicationId ?? ""),
  ].join(","));
  return [header.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}

/* ---------- audit log ---------- */

export const AUDIT_PAGE_SIZE = 25;
export type AuditFilters = { search?: string; userId?: string; actor?: string; from?: string; to?: string };
type AuditRow = typeof demoAuditTable.$inferSelect;

const auditEntry = (a: AuditRow, userName: string | null) => ({
  id: a.id, createdAt: a.createdAt.toISOString(), action: a.action, actor: a.actor, userId: a.profileId, userName,
});

/** `userId = "platform"` means entries not tied to a user (global freeze, global limits…). */
function auditWhere(f: AuditFilters) {
  const terms: SQL[] = [];
  if (f.userId === "platform") terms.push(sql`${demoAuditTable.profileId} is null`);
  else if (f.userId) terms.push(eq(demoAuditTable.profileId, f.userId));
  if (f.actor) terms.push(eq(demoAuditTable.actor, f.actor));
  terms.push(...dayRange(demoAuditTable.createdAt, f.from, f.to));
  if (f.search?.trim()) {
    const t = like(f.search);
    terms.push(or(
      ilike(demoAuditTable.action, t), ilike(demoAuditTable.actor, t), ilike(sql`${demoAuditTable.id}::text`, t),
      ilike(sql`coalesce(${demoAuditTable.profileId}, '')`, t), ilike(sql`coalesce(${demoProfilesTable.name}, '')`, t),
    )!);
  }
  return and(...terms);
}

const auditQuery = (where: SQL | undefined) => db.select({ a: demoAuditTable, name: demoProfilesTable.name })
  .from(demoAuditTable).leftJoin(demoProfilesTable, eq(demoProfilesTable.id, demoAuditTable.profileId))
  .where(where).orderBy(desc(demoAuditTable.createdAt), desc(demoAuditTable.id));

export async function listAudit(f: AuditFilters, page: number) {
  const where = auditWhere(f);
  const rows = await auditQuery(where).limit(AUDIT_PAGE_SIZE).offset((page - 1) * AUDIT_PAGE_SIZE);
  const [count] = await db.select({ n: sql<number>`count(*)::int` })
    .from(demoAuditTable).leftJoin(demoProfilesTable, eq(demoProfilesTable.id, demoAuditTable.profileId)).where(where);
  const actors = await db.selectDistinct({ actor: demoAuditTable.actor }).from(demoAuditTable).orderBy(demoAuditTable.actor).limit(200);
  return {
    items: rows.map(r => auditEntry(r.a, r.name)), total: count?.n ?? 0, page, pageSize: AUDIT_PAGE_SIZE,
    actors: actors.map(a => a.actor),
  };
}

export async function exportAuditCsv(f: AuditFilters) {
  const rows = await auditQuery(auditWhere(f)).limit(10000);
  const header = ["Entry ID", "Date (UTC)", "User ID", "User", "Action", "Done by"];
  const lines = rows.map(({ a, name }) => [
    cell(a.id), cell(a.createdAt.toISOString()), cell(a.profileId ?? ""), cell(name ?? (a.profileId ? "" : "Platform")), cell(a.action), cell(a.actor),
  ].join(","));
  return [header.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}

/* ---------- identity documents ---------- */

type KycRow = typeof demoKycDocumentsTable.$inferSelect;
const kycItem = (d: KycRow, p: DemoProfile, mimeType: string | null) => ({
  id: d.id, name: d.name, kind: d.kind as "Government ID" | "Proof of address", status: d.status as "Pending" | "Verified" | "Rejected",
  sample: !d.fileId,
  ...(d.sampleConfidence != null && !d.fileId ? { confidence: d.sampleConfidence } : {}),
  ...(d.fileId ? { url: fileUrl("admin", d.fileId), ...(mimeType ? { mimeType } : {}) } : {}),
  submittedAt: d.createdAt.toISOString(),
  ...(d.reviewNote ? { reviewNote: d.reviewNote } : {}),
  ...(d.reviewedAt ? { reviewedAt: d.reviewedAt.toISOString() } : {}),
  ...(d.reviewedBy ? { reviewedBy: d.reviewedBy } : {}),
  userId: p.id, userName: p.name, organization: p.organization,
  verificationLevel: p.verificationLevel as "Verified" | "Pending" | "Rejected" | "Unsubmitted",
});

const kycQuery = () => db.select({ d: demoKycDocumentsTable, p: demoProfilesTable, mimeType: demoFilesTable.mimeType })
  .from(demoKycDocumentsTable)
  .innerJoin(demoProfilesTable, eq(demoProfilesTable.id, demoKycDocumentsTable.profileId))
  .leftJoin(demoFilesTable, eq(demoFilesTable.id, demoKycDocumentsTable.fileId));

export async function adminKycQueue() {
  const pending = await kycQuery()
    .where(and(eq(demoKycDocumentsTable.superseded, false), eq(demoKycDocumentsTable.status, "Pending"))).orderBy(asc(demoKycDocumentsTable.createdAt));
  const reviewed = await kycQuery().where(isNotNull(demoKycDocumentsTable.reviewedAt)).orderBy(desc(demoKycDocumentsTable.reviewedAt)).limit(20);
  return {
    pending: pending.map(r => kycItem(r.d, r.p, r.mimeType)),
    reviewed: reviewed.map(r => kycItem(r.d, r.p, r.mimeType)),
  };
}

/**
 * Approve or reject the current document of one kind, then recompute the user's level:
 * both kinds verified → Verified; any current document rejected → Rejected; otherwise unchanged
 * (so a verified user stays verified while a replacement is still waiting).
 */
export async function reviewKycDocument(id: string, decision: "Verified" | "Rejected", note: string | undefined, actor: string) {
  const text = (note ?? "").trim();
  if (decision === "Rejected" && text.length < 5) throw new DemoInputError("Tell the applicant why, in at least 5 characters.");
  const done = await db.transaction(async tx => {
    const [peek] = await tx.select({ profileId: demoKycDocumentsTable.profileId }).from(demoKycDocumentsTable).where(eq(demoKycDocumentsTable.id, id));
    if (!peek) return false;
    const profile = await lockProfile(tx, peek.profileId);
    const [d] = await tx.select().from(demoKycDocumentsTable).where(eq(demoKycDocumentsTable.id, id)).for("update");
    if (!d || !profile) return false;
    if (d.superseded) throw new DemoInputError("This document has been replaced by a newer upload. Review that one instead.");
    if (d.status !== "Pending") throw new DemoInputError(`This document was already ${d.status.toLowerCase()}.`);
    await tx.update(demoKycDocumentsTable).set({ status: decision, reviewNote: text || null, reviewedAt: new Date(), reviewedBy: actor }).where(eq(demoKycDocumentsTable.id, id));
    const current = await tx.select({ kind: demoKycDocumentsTable.kind, status: demoKycDocumentsTable.status }).from(demoKycDocumentsTable)
      .where(and(eq(demoKycDocumentsTable.profileId, profile.id), eq(demoKycDocumentsTable.superseded, false)));
    const allVerified = KYC_KINDS.every(k => current.some(c => c.kind === k && c.status === "Verified"));
    const level = allVerified ? "Verified" : current.some(c => c.status === "Rejected") ? "Rejected" : profile.verificationLevel;
    if (level !== profile.verificationLevel) await tx.update(demoProfilesTable).set({ verificationLevel: level }).where(eq(demoProfilesTable.id, profile.id));
    await tx.insert(demoAuditTable).values({
      profileId: profile.id, actor,
      action: `KYC ${d.kind} ${decision === "Verified" ? "approved" : "rejected"}${text ? ` · ${text}` : ""}${level !== profile.verificationLevel ? ` (level ${level.toLowerCase()})` : ""}`,
    });
    const message = decision === "Rejected"
      ? `Your ${d.kind} wasn't accepted: ${text} Please upload a new copy.`
      : level === "Verified" && profile.verificationLevel !== "Verified" ? "Your identity is verified" : `Your ${d.kind} was approved`;
    await notifyUser(profile.id, message, "/settings#verification", tx);
    return true;
  });
  if (!done) return undefined;
  const [r] = await kycQuery().where(eq(demoKycDocumentsTable.id, id));
  return r ? kycItem(r.d, r.p, r.mimeType) : undefined;
}

/* ---------- search ---------- */

/** Header search across users, applications, ledger entries and the audit log (name, text or ID). */
export async function adminSearch(q: string) {
  const t = like(q);
  const users = await db.select({ id: demoProfilesTable.id, name: demoProfilesTable.name, email: demoProfilesTable.email, organization: demoProfilesTable.organization })
    .from(demoProfilesTable)
    .where(or(ilike(demoProfilesTable.id, t), ilike(demoProfilesTable.name, t), ilike(demoProfilesTable.email, t), ilike(demoProfilesTable.organization, t), ilike(demoProfilesTable.maskedId, t)))
    .orderBy(demoProfilesTable.name).limit(5);
  const apps = await db.select({ a: demoApplicationsTable, name: demoProfilesTable.name, organization: demoProfilesTable.organization })
    .from(demoApplicationsTable).innerJoin(demoProfilesTable, eq(demoProfilesTable.id, demoApplicationsTable.profileId))
    .where(or(ilike(demoApplicationsTable.id, t), ilike(demoApplicationsTable.title, t), ilike(demoApplicationsTable.category, t)))
    .orderBy(desc(demoApplicationsTable.submittedAt)).limit(5);
  const ledger = await db.select({ l: demoLedgerTable, name: demoProfilesTable.name })
    .from(demoLedgerTable).innerJoin(demoProfilesTable, eq(demoProfilesTable.id, demoLedgerTable.profileId))
    .where(or(ilike(sql`${demoLedgerTable.id}::text`, t), ilike(sql`coalesce(${demoLedgerTable.requestId}::text, '')`, t), ilike(demoLedgerTable.reason, t)))
    .orderBy(desc(demoLedgerTable.createdAt)).limit(5);
  const audit = await db.select({ a: demoAuditTable, name: demoProfilesTable.name })
    .from(demoAuditTable).leftJoin(demoProfilesTable, eq(demoProfilesTable.id, demoAuditTable.profileId))
    .where(or(ilike(demoAuditTable.action, t), ilike(demoAuditTable.actor, t), ilike(sql`${demoAuditTable.id}::text`, t)))
    .orderBy(desc(demoAuditTable.createdAt)).limit(5);
  return {
    users,
    applications: apps.map(r => adminApplication(r.a, r)),
    transactions: ledger.map(r => ledgerEntry(r.l, r.name)),
    audit: audit.map(({ a, name }) => ({
      id: a.id, action: a.action, actor: a.actor, subject: name ?? "Platform", createdAt: a.createdAt.toISOString(), ...(a.profileId ? { userId: a.profileId } : {}),
    })),
  };
}
