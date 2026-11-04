import { and, asc, desc, eq, gte, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, demoProfilesTable, demoAuditTable, demoLedgerTable, demoSettingsTable, demoRequestsTable, demoApplicationsTable, demoPaymentMethodsTable, type DemoProfile } from "@workspace/db";
import { notifyUser, requestEmailData, requestReference } from "./notifications";
import { activeApplicationsFilter, applicationSummary } from "./applicantRecords";
import { currentKycDocuments } from "./kyc";
import { fileUrl, storeUpload, type DbTx } from "./uploads";
import { findMethod, methodLogoUrl, methodRules } from "./paymentMethods";
import { amountProblem, describeAmountRule, parseAnswers, sourceAllowed, SOURCE_LABEL, SOURCES_LABEL, toCents, type BalanceSource, type WithdrawalSources } from "./paymentRules";
import { grantRecommendations, storedAnswers } from "./matchmaking";
import { APPEND_ONLY_TRIGGERS } from "./demoSeed";
import { GetAdminUserResponse } from "@workspace/api-zod";
import { effectiveLimits, limitProblem, limitsOut, withdrawnLast24h } from "./withdrawalLimits";
import { countCardRequests } from "./cards";
import { centsOut, effectiveEligible, tierAmount, tierAmountsFrom } from "./eligibleAmount";

export class DemoInputError extends Error {}

/** A user's effective withdrawal limits plus what they withdrew in the last 24 hours, in API shape. */
export async function userWithdrawalLimits(profile: DemoProfile) {
  const [settings] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  const used = (await withdrawnLast24h([profile.id])).get(profile.id) ?? 0;
  return { custom: profile.withdrawalLimitCustom, ...limitsOut(effectiveLimits(profile, settings)), usedLast24h: used / 100 };
}

/** A user's eligible amount (custom, or their tier's), plus the tier amount it replaces, in API shape. */
export async function userEligibleAmount(profile: DemoProfile) {
  const [settings] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  return {
    custom: profile.eligibleCustom,
    amount: centsOut(effectiveEligible(profile, settings)),
    tierAmount: centsOut(tierAmount(tierAmountsFrom(settings), profile.tier)),
  };
}


export function summary(person: DemoProfile, pendingKycDocuments = 0) {
  return {
    pendingKycDocuments,
    id: person.id, name: person.name, email: person.email, organization: person.organization,
    tier: person.tier, verificationLevel: person.verificationLevel, status: person.status,
    grantBalance: person.grantCents / 100, depositBalance: person.depositCents / 100,
    joinedAt: person.joinedAt,
  };
}

export function applicantProfile(person: DemoProfile) {
  return {
    id: person.id, name: person.name, email: person.email, organization: person.organization,
    verified: person.verificationLevel === "Verified", phone: person.phone, telegram: person.telegram,
    ...(person.avatarFileId ? { avatarUrl: fileUrl("applicant", person.avatarFileId) } : {}),
  };
}

export async function getUser(id: string) {
  const [person] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, id));
  if (!person) return undefined;
  const audit = await db.select().from(demoAuditTable).where(eq(demoAuditTable.profileId, id)).orderBy(desc(demoAuditTable.createdAt)).limit(30);
  const cards = Array.isArray(person.cards) ? person.cards.map((card: Record<string, unknown>) => ({
    // The card account's balance shows on the user's live virtual card; a cancelled card shows what it held then (0).
    ...card, balance: card.kind === "Virtual" && card.status !== "Cancelled" ? person.cardCents / 100 : Number(card.balance ?? 0),
  })) : [];
  const documents = (await currentKycDocuments([id], "admin")).map(({ profileId: _p, ...d }) => d);
  return GetAdminUserResponse.parse({
    ...person,
    documents,
    ...(person.avatarFileId ? { avatarUrl: fileUrl("admin", person.avatarFileId) } : {}),
    balances: { grant: person.grantCents / 100, deposit: person.depositCents / 100, card: person.cardCents / 100 },
    cards,
    withdrawalLimits: await userWithdrawalLimits(person),
    eligibleAmount: await userEligibleAmount(person),
    audit: audit.map(entry => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
  });
}

export type UserSort = "name" | "joined" | "grant" | "deposit" | "tier" | "status";
const userSortColumn = {
  name: sql`lower(${demoProfilesTable.name})`, joined: demoProfilesTable.joinedAt, grant: demoProfilesTable.grantCents,
  deposit: demoProfilesTable.depositCents, tier: demoProfilesTable.tier, status: demoProfilesTable.status,
} satisfies Record<UserSort, unknown>;
/** Names, tiers and statuses read best A→Z / low→high; dates and balances newest / largest first. */
export const defaultUserDir = (sort: UserSort): "asc" | "desc" => (sort === "joined" || sort === "grant" || sort === "deposit" ? "desc" : "asc");

/** One page of the directory, sorted in the database; ties fall back to the ID so pages never overlap. */
export async function listUsers(opts: { search?: string; status?: string; sort?: UserSort; dir?: "asc" | "desc"; page?: number; pageSize?: number } = {}) {
  const { search = "", status = "all", sort = "name", page = 1, pageSize = 25 } = opts;
  const dir = opts.dir ?? defaultUserDir(sort);
  const terms = [];
  if (search.trim()) {
    const term = `%${search.trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    terms.push(or(ilike(demoProfilesTable.name, term), ilike(demoProfilesTable.email, term), ilike(demoProfilesTable.organization, term)));
  }
  if (status !== "all") terms.push(eq(demoProfilesTable.status, status === "active" ? "Active" : "Frozen"));
  const where = and(...terms);
  const order = dir === "asc" ? asc : desc;
  const rows = await db.select().from(demoProfilesTable).where(where)
    .orderBy(order(userSortColumn[sort]), order(demoProfilesTable.id)).limit(pageSize).offset((page - 1) * pageSize);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(demoProfilesTable).where(where);
  const pending = await pendingKycByProfile(rows.map(r => r.id));
  return { items: rows.map(r => summary(r, pending.get(r.id) ?? 0)), total: count?.n ?? 0, page, pageSize };
}

/** Count of current identity documents awaiting review, per profile. */
async function pendingKycByProfile(ids: string[]) {
  const docs = await currentKycDocuments(ids, "admin");
  const counts = new Map<string, number>();
  for (const d of docs) if (d.status === "Pending") counts.set(d.profileId, (counts.get(d.profileId) ?? 0) + 1);
  return counts;
}

export async function applicantDashboard(profileId: string, monthly: boolean) {
  const [person] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId));
  if (!person) throw new Error(`Applicant ${profileId} is missing`);
  // Sample dollar amounts submitted vs. under review per period.
  const labels = monthly ? ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const submitted = monthly ? [26000, 18000, 7500, 15500, 21500, 9000, 17500, 11000] : [4000, 6500, 2500, 5000, 7000, 3000, 1500];
  const review = monthly ? [4000, 16000, 4500, 12000, 6500, 4500, 9500, 6000] : [1500, 2000, 1000, 3500, 2500, 1000, 500];
  const apps = await db.select().from(demoApplicationsTable)
    .where(and(eq(demoApplicationsTable.profileId, person.id), activeApplicationsFilter)).orderBy(desc(demoApplicationsTable.submittedAt));
  // Any application ever submitted counts, including one withdrawn since.
  const [{ submittedAny }] = await db.select({ submittedAny: sql<boolean>`count(*) > 0` }).from(demoApplicationsTable).where(eq(demoApplicationsTable.profileId, person.id));
  const [{ approvedAwards }] = await db.select({ approvedAwards: sql<number>`count(*)::int` }).from(demoApplicationsTable)
    .where(and(eq(demoApplicationsTable.profileId, person.id), eq(demoApplicationsTable.status, "Approved")));
  const eligible = await userEligibleAmount(person);
  return {
    profile: applicantProfile(person),
    totalBudget: 50000, allocatedFunds: person.grantCents / 100, remainingFunds: 50000 - person.grantCents / 100,
    fundingTrend: labels.map((label, index) => ({ label, submitted: submitted[index], review: review[index] })),
    setupCards: [
      { id: "matchmaking", title: "Grant Matchmaking", description: "Answer five quick questions and we'll rank grants for your organization.", actionLabel: "Find my matches", complete: storedAnswers(person) !== null },
      { id: "proposal", title: "Submit First Proposal", description: "Start an application and attach your proposal as a PDF or Word file. You can follow it from review to decision.", actionLabel: "Start an application", complete: submittedAny },
    ],
    highlights: apps.slice(0, 5).map(applicationSummary),
    recommendations: grantRecommendations(storedAnswers(person)),
    applicationCount: apps.length,
    balanceSummary: {
      tier: person.tier, eligibleAmount: eligible.amount, grantBalance: person.grantCents / 100,
      approvedAwards, depositBalance: person.depositCents / 100,
    },
  };
}

export async function adminDashboard() {
  const people = await db.select().from(demoProfilesTable);
  const pendingKyc = await pendingKycByProfile(people.map(p => p.id));
  const appCounts = await db.select({ status: demoApplicationsTable.status, n: sql<number>`count(*)::int` }).from(demoApplicationsTable).groupBy(demoApplicationsTable.status);
  const appsWith = (...statuses: string[]) => appCounts.filter(c => statuses.includes(c.status)).reduce((t, c) => t + c.n, 0);
  const activity = await db.select().from(demoAuditTable).orderBy(desc(demoAuditTable.createdAt)).limit(8);
  const [settings] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  const pending = await db.select({ kind: demoRequestsTable.kind, n: sql<number>`count(*)::int` }).from(demoRequestsTable)
    .where(eq(demoRequestsTable.status, "Pending")).groupBy(demoRequestsTable.kind);
  const pendingOf = (kind: string) => pending.find(p => p.kind === kind)?.n ?? 0;
  return {
    moneyTrend: await moneyTrend(),
    systemHealth: await systemHealth(),
    totalUsers: people.length, activeUsers: people.filter(p => p.status === "Active").length,
    pendingApplications: appsWith("Submitted", "Review"),
    pendingKyc: people.filter(p => p.verificationLevel === "Pending" || pendingKyc.has(p.id)).length,
    pendingDeposits: pendingOf("Deposit"), pendingWithdrawals: pendingOf("Withdrawal"),
    pendingCardActivations: await countCardRequests(),
    totalGrantBalances: people.reduce((sum, p) => sum + p.grantCents, 0) / 100,
    totalDepositBalances: people.reduce((sum, p) => sum + p.depositCents, 0) / 100,
    applicationsByStatus: ["Submitted", "Review", "Changes requested", "Approved", "Declined"].map(status => ({ status, count: appsWith(status) })),
    recentActivity: activity.map(a => ({ id: a.id, action: a.action, subject: people.find(p => p.id === a.profileId)?.name ?? "Platform", createdAt: a.createdAt.toISOString() })),
    globalFrozen: settings?.frozen ?? false,
  };
}

/** Real checks: database round-trip time, and whether the append-only triggers protecting the logs are installed. */
async function systemHealth() {
  const started = Date.now();
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_trigger where not tgisinternal and tgname in (${sql.join(APPEND_ONLY_TRIGGERS.map(t => sql`${t}`), sql`, `)})`)).rows;
  const ms = Date.now() - started;
  return {
    api: "Operational" as const,
    database: ms < 500 ? "Operational" as const : "Degraded" as const,
    auditLog: n === APPEND_ONLY_TRIGGERS.length ? "Intact" as const : "Review required" as const,
    // Two-person approval needs real admin identities (plan item A7).
    fourEyes: false,
  };
}

/** Ledger money in and out per calendar month (UTC), last six months. Opening balances are not movements. */
async function moneyTrend() {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)));
  const rows = await db.select({
    month: sql<string>`to_char(date_trunc('month', ${demoLedgerTable.createdAt} at time zone 'UTC'), 'YYYY-MM')`,
    inflow: sql<number>`coalesce(sum(${demoLedgerTable.amountCents}) filter (where ${demoLedgerTable.amountCents} > 0), 0)::bigint`,
    outflow: sql<number>`coalesce(-sum(${demoLedgerTable.amountCents}) filter (where ${demoLedgerTable.amountCents} < 0), 0)::bigint`,
  }).from(demoLedgerTable)
    .where(and(gte(demoLedgerTable.createdAt, months[0]!), ne(demoLedgerTable.kind, "Opening balance")))
    .groupBy(sql`1`);
  return months.map(m => {
    const key = m.toISOString().slice(0, 7);
    const row = rows.find(r => r.month === key);
    return { label: m.toLocaleString("en-US", { month: "short", timeZone: "UTC" }), inflow: Number(row?.inflow ?? 0) / 100, outflow: Number(row?.outflow ?? 0) / 100 };
  });
}

const overrideLabel: Record<string, string> = { emailOverride: "email notifications", inAppOverride: "in-app notifications" };
type ProfileChanges = { name?: string; phone?: string; telegram?: string; tier?: number; status?: string; permissions?: unknown };

export async function changeProfile(id: string, changes: ProfileChanges, actor: string) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, id)).for("update");
    if (!current) return false;
    const normalized = { ...changes, ...(changes.name === undefined ? {} : { name: changes.name.trim() }) };
    if (normalized.name !== undefined && normalized.name.length < 2) throw new DemoInputError("Name must contain at least two characters.");
    // Audit only what actually changed; permissions are compared key by key.
    const fields: string[] = [];
    for (const [key, value] of Object.entries(normalized) as [keyof ProfileChanges, unknown][]) {
      if (value === undefined) continue;
      if (key === "permissions") {
        const before = (current.permissions ?? {}) as Record<string, boolean | null>;
        for (const [perm, on] of Object.entries(value as Record<string, boolean | null>)) {
          if ((before[perm] ?? null) === on) continue;
          const override = overrideLabel[perm];
          fields.push(override ? `${override}: ${on === null ? "left to the user" : on ? "always on" : "always off"} (admin override)` : `${perm} ${on ? "on" : "off"}`);
        }
      } else if (current[key] !== value) {
        fields.push(key === "status" ? `status (${String(value).toLowerCase()})` : key === "tier" ? `tier (Tier ${value})` : key);
      }
    }
    if (!fields.length) return true;
    // Permissions merge into the stored ones, so a client that doesn't know a key (e.g. the overrides) never erases it.
    if (normalized.permissions) normalized.permissions = { ...(current.permissions as object ?? {}), ...(normalized.permissions as object) };
    await tx.update(demoProfilesTable).set(normalized).where(eq(demoProfilesTable.id, id));
    await tx.insert(demoAuditTable).values({ profileId: id, actor, action: `Updated ${fields.join(", ")}` });
    if (changes.status && changes.status !== current.status) {
      await notifyUser(id, changes.status === "Frozen" ? "Your account has been frozen. Deposits and withdrawals are paused." : "Your account is active again.", "/settings", tx);
    }
    return true;
  });
}

/** The applicant's own preferences (today only email notifications); audited like any profile change. Refused while an administrator overrides it. */
export async function changePreferences(id: string, prefs: { emailNotifications: boolean }, actor: string) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, id)).for("update");
    if (!current) throw new Error(`Applicant ${id} is missing`);
    const permissions = (current.permissions ?? {}) as Record<string, boolean | null>;
    if (typeof permissions.emailOverride === "boolean") throw new DemoInputError("Your administrator has set your email notifications, so they can't be changed here.");
    if (permissions.emailNotifications !== prefs.emailNotifications) {
      await tx.update(demoProfilesTable).set({ permissions: { ...permissions, emailNotifications: prefs.emailNotifications } }).where(eq(demoProfilesTable.id, id));
      await tx.insert(demoAuditTable).values({ profileId: id, actor, action: `Turned email notifications ${prefs.emailNotifications ? "on" : "off"}` });
    }
    return { emailNotifications: prefs.emailNotifications };
  });
}

const accountName = { grant: "grant", deposit: "deposit", card: "card" } as const;
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Credit or debit a balance: balance, ledger, audit and notification in one transaction (settings → profile locks, like approvals).
 * A debit never takes a balance below $0, and never takes the grant or deposit balance below what pending withdrawals from it hold.
 */
export async function adjustBalance(id: string, account: "grant" | "deposit" | "card", amount: number, reason: string, actor: string, direction: "credit" | "debit" = "credit") {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000000 || Math.abs(amount * 100 - cents) > 0.00001) throw new DemoInputError("Use an amount between $0.01 and $1,000,000 with at most two decimals.");
  const why = reason.trim();
  if (why.length < 5) throw new DemoInputError("Explain the adjustment in at least five characters.");
  const debit = direction === "debit";
  return db.transaction(async tx => {
    const [settings] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    if (settings?.frozen) throw new DemoInputError("Demo financial adjustments are paused by the global freeze.");
    const [current] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, id)).for("update");
    if (!current) return undefined;
    if (current.status === "Frozen") throw new DemoInputError("Unfreeze the demo account before adjusting its balance.");
    // Top-ups go onto a card, so one must be active; debits can still empty the card account whatever the cards' state.
    if (account === "card" && !debit && !(Array.isArray(current.cards) && current.cards.some((c: { status?: string }) => c.status === "Active"))) {
      throw new DemoInputError("This user has no active card to top up. Issue a card or unfreeze one first.");
    }
    const key = account === "grant" ? "grantCents" : account === "deposit" ? "depositCents" : "cardCents";
    const next = debit ? current[key] - cents : current[key] + cents;
    if (next > 2000000000) throw new DemoInputError("This would exceed the demo account limit.");
    if (next < 0) throw new DemoInputError(`The ${account} balance is only ${dollars(current[key])}, so ${dollars(cents)} can't be removed.`);
    if (debit && account !== "card") {
      const held = current[key] - await availableCents(current, account, tx);
      if (next < held) throw new DemoInputError(`This would leave ${dollars(next)}, less than the ${dollars(held)} held for pending withdrawals. Decline those first or remove less.`);
    }
    await tx.update(demoProfilesTable).set({ [key]: next }).where(eq(demoProfilesTable.id, id));
    await tx.insert(demoLedgerTable).values({ profileId: id, kind: debit ? "Debit" : "Top-up", account, amountCents: debit ? -cents : cents, reason: why, actor });
    await tx.insert(demoAuditTable).values({ profileId: id, actor, action: debit ? `Debit ${account} −${dollars(cents)} · ${why}` : `Demo ${account} top-up +${dollars(cents)} · ${why}` });
    await notifyUser(id, debit ? `${dollars(cents)} was removed from your ${accountName[account]} balance: ${why}` : `${dollars(cents)} was added to your ${accountName[account]} balance`, "/transactions", tx);
    return {
      grant: (account === "grant" ? next : current.grantCents) / 100,
      deposit: (account === "deposit" ? next : current.depositCents) / 100,
      card: (account === "card" ? next : current.cardCents) / 100,
    };
  });
}

export async function changeGlobalFreeze(frozen: boolean, actor: string, reason?: string) {
  await db.transaction(async tx => {
    await tx.update(demoSettingsTable).set({ frozen }).where(eq(demoSettingsTable.id, "platform"));
    await tx.insert(demoAuditTable).values({ actor, action: `Demo global freeze ${frozen ? "enabled" : "lifted"}${reason?.trim() ? ` · ${reason.trim()}` : ""}` });
  });
  return { frozen };
}

type RequestRow = typeof demoRequestsTable.$inferSelect;
type Snapshot = { name?: string; amountRule?: string; fields?: { id: string; label: string; type: string }[] };

export type LogoMap = Map<string, string | undefined>;

/** Current logo URL per method, for showing a list of requests (methods are never deleted once used). */
export async function methodLogos(methodIds: (string | null)[], scope: "applicant" | "admin"): Promise<LogoMap> {
  const ids = [...new Set(methodIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: demoPaymentMethodsTable.id, logoFileId: demoPaymentMethodsTable.logoFileId }).from(demoPaymentMethodsTable).where(inArray(demoPaymentMethodsTable.id, ids));
  return new Map(rows.map(r => [r.id, methodLogoUrl(r, scope)]));
}

/** A request's method, balance, answers and proof as both sides show them: labels come from the copy taken when it was placed. */
export function requestDetails(r: RequestRow, scope: "applicant" | "admin", logos: LogoMap) {
  const snap = (r.methodSnapshot ?? null) as Snapshot | null;
  const values = (r.fieldValues ?? {}) as Record<string, string>;
  const logoUrl = r.methodId ? logos.get(r.methodId) : undefined;
  return {
    ...(snap && r.methodId ? { method: { id: r.methodId, name: snap.name ?? "Payment method", ...(logoUrl ? { logoUrl } : {}) } } : {}),
    ...(r.kind === "Withdrawal" ? { source: (r.source === "deposit" ? "deposit" : "grant") as BalanceSource } : {}),
    details: (snap?.fields ?? []).filter(f => values[f.id]).map(f => ({ label: f.label, value: values[f.id]! })),
    ...(r.proofFileId ? { proofUrl: fileUrl(scope, r.proofFileId) } : {}),
  };
}

const requestTransaction = (r: RequestRow, logos: LogoMap) => ({
  id: r.id, type: r.kind, account: r.kind === "Deposit" ? "deposit" : r.source === "deposit" ? "deposit" : "grant", direction: r.kind === "Deposit" ? "in" : "out",
  amount: r.amountCents / 100, status: r.status, createdAt: r.createdAt.toISOString(),
  description: `${r.note || ((r.methodSnapshot as Snapshot | null)?.name ? `${r.kind} via ${(r.methodSnapshot as Snapshot).name}` : `${r.kind} request`)}${r.status === "Declined" && r.reviewNote ? ` · Declined: ${r.reviewNote}` : ""}`,
  reference: requestReference(r.id), ...(r.reviewNote ? { reviewNote: r.reviewNote } : {}),
  ...requestDetails(r, "applicant", logos),
});

/** A balance minus withdrawals from it still awaiting review (older withdrawals without a source were all from the grant balance). */
export async function availableCents(profile: DemoProfile, source: BalanceSource, tx: Pick<typeof db, "select"> = db) {
  const [row] = await tx.select({ sum: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}), 0)::int` }).from(demoRequestsTable)
    .where(and(eq(demoRequestsTable.profileId, profile.id), eq(demoRequestsTable.kind, "Withdrawal"), eq(demoRequestsTable.status, "Pending"),
      source === "grant" ? or(eq(demoRequestsTable.source, "grant"), isNull(demoRequestsTable.source)) : eq(demoRequestsTable.source, "deposit")));
  return Math.max(0, (source === "grant" ? profile.grantCents : profile.depositCents) - (row?.sum ?? 0));
}

export async function applicantAccount(profileId: string) {
  const person = await getUser(profileId);
  const [profile] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId));
  if (!person || !profile) throw new Error(`Applicant ${profileId} is missing`);
  const [settings] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  // Ledger rows caused by a request are shown through the request itself.
  const ledger = await db.select().from(demoLedgerTable)
    .where(and(eq(demoLedgerTable.profileId, profileId), isNull(demoLedgerTable.requestId))).orderBy(desc(demoLedgerTable.createdAt)).limit(100);
  const requests = await db.select().from(demoRequestsTable).where(eq(demoRequestsTable.profileId, profileId)).orderBy(desc(demoRequestsTable.createdAt)).limit(100);
  const logos = await methodLogos(requests.map(r => r.methodId), "applicant");
  const transactions = [
    ...ledger.map(l => ({
      id: l.id, type: l.kind, account: l.account, direction: l.amountCents < 0 ? "out" : "in", amount: Math.abs(l.amountCents) / 100,
      description: l.reason, status: "Completed", createdAt: l.createdAt.toISOString(), details: [],
    })),
    ...requests.map(r => requestTransaction(r, logos)),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    status: person.status, platformFrozen: settings?.frozen ?? false, tier: person.tier, verificationLevel: person.verificationLevel,
    permissions: person.permissions, balances: person.balances,
    availableToWithdraw: { grant: (await availableCents(profile, "grant")) / 100, deposit: (await availableCents(profile, "deposit")) / 100 },
    withdrawalSources: profile.withdrawalSources as WithdrawalSources,
    cards: person.cards, transactions, withdrawalLimits: await userWithdrawalLimits(profile),
  };
}

export type RequestInput = { kind: "Deposit" | "Withdrawal"; methodId: string; amount: number; source?: BalanceSource; values?: unknown; note?: string };

/**
 * Place a deposit or withdrawal request through one of the administrator's methods.
 * The method's own rules (amount, fields, proof) are checked first; then, in one transaction with the settings and profile
 * rows locked, the same checks as always: freezes, KYC, and for withdrawals the chosen balance and the withdrawal limits.
 * A payment proof is stored in that same transaction, so a refused request never leaves a file behind.
 */
export async function createApplicantRequest(profileId: string, input: RequestInput, file?: Express.Multer.File) {
  const { kind } = input;
  const cents = toCents(input.amount);
  if (cents === null) throw new DemoInputError("Enter an amount between $0.01 and $1,000,000 with at most two decimals.");
  const method = await findMethod(input.methodId);
  if (!method || method.kind !== kind || !method.enabled) throw new DemoInputError(`This ${kind.toLowerCase()} method isn't available any more. Choose another one.`);
  const rules = methodRules(method);
  const amountIssue = amountProblem(rules, cents);
  if (amountIssue) throw new DemoInputError(amountIssue);
  const answers = parseAnswers(rules.fields, input.values);
  if (typeof answers === "string") throw new DemoInputError(answers);
  const hasFile = !!file && file.size > 0;
  if (rules.proofMode === "required" && !hasFile) throw new DemoInputError("Upload your payment proof (a photo, screenshot or PDF of the payment).");
  if (rules.proofMode === "off" && hasFile) throw new DemoInputError(`${method.name} doesn't take a payment proof. Remove the file and try again.`);
  const note = (input.note ?? "").trim().slice(0, 240);
  const snapshot: Snapshot = { name: method.name, amountRule: describeAmountRule(rules), fields: rules.fields.map(f => ({ id: f.id, label: f.label, type: f.type })) };

  const place = async (tx: DbTx, proofFileId: string | null) => {
    const [settings] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    if (settings?.frozen) throw new DemoInputError("Deposits and withdrawals are paused while the platform is frozen.");
    const [profile] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId)).for("update");
    if (!profile) throw new Error(`Applicant ${profileId} is missing`);
    if (profile.status === "Frozen") throw new DemoInputError("Your account is frozen. Contact support to make changes.");
    const perms = (profile.permissions ?? {}) as { withdrawalKycRequired?: boolean; depositKycRequired?: boolean };
    const kycNeeded = kind === "Withdrawal" ? perms.withdrawalKycRequired : perms.depositKycRequired;
    if (kycNeeded && profile.verificationLevel !== "Verified") throw new DemoInputError(`Identity verification is required before you can submit a ${kind.toLowerCase()}. Upload your documents in Settings.`);
    let source: BalanceSource | null = null;
    if (kind === "Withdrawal") {
      const allowed = profile.withdrawalSources as WithdrawalSources;
      source = input.source ?? (allowed === "both" ? null : allowed);
      if (!source) throw new DemoInputError("Choose which balance to withdraw from.");
      if (!sourceAllowed(allowed, source)) throw new DemoInputError(`Withdrawals from your ${SOURCE_LABEL[source]} aren't available. You can withdraw from your ${SOURCES_LABEL[allowed]}.`);
      const available = await availableCents(profile, source, tx);
      if (cents > available) throw new DemoInputError(`This is more than the ${dollars(available)} available in your ${SOURCE_LABEL[source]}, after pending withdrawals.`);
      // The profile row is locked above, so two quick requests can't both fit under the daily total.
      const problem = limitProblem(effectiveLimits(profile, settings), (await withdrawnLast24h([profile.id], tx)).get(profile.id) ?? 0, cents);
      if (problem) throw new DemoInputError(problem);
    }
    const [row] = await tx.insert(demoRequestsTable).values({
      profileId: profile.id, kind, amountCents: cents, note, source, methodId: method.id, methodSnapshot: snapshot, fieldValues: answers, proofFileId,
    }).returning();
    await tx.insert(demoAuditTable).values({ profileId: profile.id, actor: profile.name, action: `${kind} request submitted +$${(cents / 100).toFixed(2)} via ${method.name}${source ? ` from the ${SOURCE_LABEL[source]}` : ""}${proofFileId ? ", with payment proof" : ""}` });
    const amount = `$${(cents / 100).toFixed(2)}`;
    await notifyUser(profile.id, kind === "Withdrawal"
      ? `Withdrawal request of ${amount} via ${method.name} received (ref ${requestReference(row!.id)}). Our finance team will review it; your funds are released once it's approved.`
      : `Deposit request of ${amount} via ${method.name} received (ref ${requestReference(row!.id)}). Our finance team will review it; it's added to your balance once approved.`,
    kind === "Deposit" ? "/deposits" : "/withdrawals", tx, { kind: "request_received", data: requestEmailData(row!) });
    return row!;
  };

  const row = hasFile ? await storeUpload(profileId, "proof", file, (stored, tx) => place(tx, stored.id)) : await db.transaction(tx => place(tx, null));
  return requestTransaction(row, await methodLogos([row.methodId], "applicant"));
}
