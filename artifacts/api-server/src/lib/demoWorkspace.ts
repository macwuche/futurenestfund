import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, demoProfilesTable, demoAuditTable, demoLedgerTable, demoSettingsTable, demoRequestsTable, type DemoProfile } from "@workspace/db";
import { GetAdminUserResponse } from "@workspace/api-zod";

export const demoApplicantId = "usr-jane";
export class DemoInputError extends Error {}

export const applications = [
  { id: "APP-2026-001", title: "AI Innovation Grant", category: "Technology & innovation", status: "Review", amount: 25000, submittedAt: "2026-10-08" },
  { id: "APP-2026-002", title: "Community Arts Support", category: "Arts & culture", status: "Submitted", amount: 10000, submittedAt: "2026-10-12" },
  { id: "APP-2026-003", title: "Sustainable Futures Fund", category: "Environment", status: "Approved", amount: 15000, submittedAt: "2026-09-24" },
];

export function summary(person: DemoProfile) {
  return {
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
  };
}

export async function getUser(id: string) {
  const [person] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, id));
  if (!person) return undefined;
  const audit = await db.select().from(demoAuditTable).where(eq(demoAuditTable.profileId, id)).orderBy(desc(demoAuditTable.createdAt)).limit(30);
  const cards = Array.isArray(person.cards) ? person.cards.map((card: Record<string, unknown>) => ({
    ...card, balance: card.kind === "Virtual" ? person.cardCents / 100 : Number(card.balance ?? 0),
  })) : [];
  return GetAdminUserResponse.parse({
    ...person,
    balances: { grant: person.grantCents / 100, deposit: person.depositCents / 100, card: person.cardCents / 100 },
    cards,
    audit: audit.map(entry => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
  });
}

export async function listUsers(search = "", status = "all") {
  const terms = [];
  if (search.trim()) {
    const term = `%${search.trim().slice(0, 100)}%`;
    terms.push(or(ilike(demoProfilesTable.name, term), ilike(demoProfilesTable.email, term), ilike(demoProfilesTable.organization, term)));
  }
  if (status !== "all") terms.push(eq(demoProfilesTable.status, status === "active" ? "Active" : "Frozen"));
  const rows = await db.select().from(demoProfilesTable).where(and(...terms)).orderBy(demoProfilesTable.name);
  return { items: rows.map(summary), total: rows.length };
}

export async function applicantDashboard(monthly: boolean) {
  const [person] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, demoApplicantId));
  if (!person) throw new Error("Demo applicant is missing");
  // Sample dollar amounts submitted vs. under review per period.
  const labels = monthly ? ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const submitted = monthly ? [26000, 18000, 7500, 15500, 21500, 9000, 17500, 11000] : [4000, 6500, 2500, 5000, 7000, 3000, 1500];
  const review = monthly ? [4000, 16000, 4500, 12000, 6500, 4500, 9500, 6000] : [1500, 2000, 1000, 3500, 2500, 1000, 500];
  return {
    profile: applicantProfile(person),
    totalBudget: 50000, allocatedFunds: person.grantCents / 100, remainingFunds: 50000 - person.grantCents / 100,
    fundingTrend: labels.map((label, index) => ({ label, submitted: submitted[index], review: review[index] })),
    setupCards: [
      { id: "matchmaking", title: "AI Grant Matchmaking", description: "Save time by enabling AI to integrate with your facturas and retrieve your business information.", actionLabel: "Complete Setup", complete: false },
      { id: "proposal", title: "Submit First Proposal", description: "Upload your first proposal and we'll use your facturas to pre-fill your business information.", actionLabel: "Complete Setup", complete: false },
    ],
    highlights: applications,
    recommendations: [
      { id: "grant-tech", title: "Digital Impact Fellowship", category: "Technology & innovation", amount: 30000, deadline: "2026-11-30", recommended: true },
      { id: "grant-community", title: "Community Builders Fund", category: "Community", amount: 15000, deadline: "2026-12-15", recommended: true },
      { id: "grant-green", title: "Climate Action Accelerator", category: "Environment", amount: 50000, deadline: "2026-12-01", recommended: false },
      { id: "grant-arts", title: "Emerging Artists Commission", category: "Arts & culture", amount: 8000, deadline: "2026-11-20", recommended: true },
      { id: "grant-edu", title: "Classroom Innovation Award", category: "Education", amount: 12000, deadline: "2027-01-15", recommended: false },
      { id: "grant-health", title: "Community Health Pilot Fund", category: "Health", amount: 40000, deadline: "2027-02-01", recommended: false },
      { id: "grant-open", title: "Open Source Infrastructure Grant", category: "Technology & innovation", amount: 20000, deadline: "2026-12-31", recommended: false },
      { id: "grant-youth", title: "Youth Leadership Micro-grant", category: "Community", amount: 2500, deadline: "2026-11-05", recommended: false },
      { id: "grant-water", title: "Clean Water Access Initiative", category: "Environment", amount: 75000, deadline: "2027-03-01", recommended: false },
      { id: "grant-heritage", title: "Heritage Digitization Fund", category: "Arts & culture", amount: 18000, deadline: "2027-01-31", recommended: false },
      { id: "grant-stem", title: "STEM Scholars Program", category: "Education", amount: 5000, deadline: "2026-11-25", recommended: true },
      { id: "grant-mental", title: "Mental Health Outreach Grant", category: "Health", amount: 22000, deadline: "2026-12-20", recommended: false },
    ],
    applicationCount: applications.length,
  };
}

export async function adminDashboard() {
  const people = await db.select().from(demoProfilesTable);
  const activity = await db.select().from(demoAuditTable).orderBy(desc(demoAuditTable.createdAt)).limit(8);
  const [settings] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  const pending = await db.select({ kind: demoRequestsTable.kind, n: sql<number>`count(*)::int` }).from(demoRequestsTable)
    .where(eq(demoRequestsTable.status, "Pending")).groupBy(demoRequestsTable.kind);
  const pendingOf = (kind: string) => pending.find(p => p.kind === kind)?.n ?? 0;
  return {
    totalUsers: people.length, activeUsers: people.filter(p => p.status === "Active").length,
    pendingApplications: applications.filter(a => a.status === "Review" || a.status === "Submitted").length,
    pendingKyc: people.filter(p => p.verificationLevel === "Pending").length,
    pendingDeposits: pendingOf("Deposit"), pendingWithdrawals: pendingOf("Withdrawal"),
    totalGrantBalances: people.reduce((sum, p) => sum + p.grantCents, 0) / 100,
    totalDepositBalances: people.reduce((sum, p) => sum + p.depositCents, 0) / 100,
    applicationsByStatus: ["Submitted", "Review", "Approved", "Declined"].map(status => ({ status, count: applications.filter(a => a.status === status).length })),
    recentActivity: activity.map(a => ({ id: a.id, action: a.action, subject: people.find(p => p.id === a.profileId)?.name ?? "Platform", createdAt: a.createdAt.toISOString() })),
    systemHealth: { api: "Operational", database: "Operational", auditLog: "Intact", fourEyes: false },
    globalFrozen: settings?.frozen ?? false,
  };
}

type ProfileChanges = { name?: string; phone?: string; telegram?: string; tier?: number; status?: string; permissions?: unknown };

export async function changeProfile(id: string, changes: ProfileChanges, actor: string) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, id)).for("update");
    if (!current) return false;
    const normalized = { ...changes, ...(changes.name === undefined ? {} : { name: changes.name.trim() }) };
    if (normalized.name !== undefined && normalized.name.length < 2) throw new DemoInputError("Name must contain at least two characters.");
    const fields = Object.keys(normalized);
    if (!fields.length) return true;
    await tx.update(demoProfilesTable).set(normalized).where(eq(demoProfilesTable.id, id));
    await tx.insert(demoAuditTable).values({ profileId: id, actor, action: `Updated ${fields.join(", ")}${changes.status ? ` (${changes.status.toLowerCase()})` : ""}` });
    return true;
  });
}

export async function adjustBalance(id: string, account: "grant" | "deposit" | "card", amount: number, reason: string) {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000000 || Math.abs(amount * 100 - cents) > 0.00001) throw new DemoInputError("Use an amount between $0.01 and $1,000,000 with at most two decimals.");
  if (reason.trim().length < 5) throw new DemoInputError("Explain the adjustment in at least five characters.");
  return db.transaction(async tx => {
    const [settings] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    if (settings?.frozen) throw new DemoInputError("Demo financial adjustments are paused by the global freeze.");
    const [current] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, id)).for("update");
    if (!current) return undefined;
    if (current.status === "Frozen") throw new DemoInputError("Unfreeze the demo account before adjusting its balance.");
    const key = account === "grant" ? "grantCents" : account === "deposit" ? "depositCents" : "cardCents";
    const next = current[key] + cents;
    if (next > 2000000000) throw new DemoInputError("This would exceed the demo account limit.");
    await tx.update(demoProfilesTable).set({ [key]: next }).where(eq(demoProfilesTable.id, id));
    await tx.insert(demoLedgerTable).values({ profileId: id, account, amountCents: cents, reason: reason.trim() });
    await tx.insert(demoAuditTable).values({ profileId: id, action: `Demo ${account} top-up +$${amount.toFixed(2)} · ${reason.trim()}` });
    return {
      grant: (account === "grant" ? next : current.grantCents) / 100,
      deposit: (account === "deposit" ? next : current.depositCents) / 100,
      card: (account === "card" ? next : current.cardCents) / 100,
    };
  });
}

export async function changeGlobalFreeze(frozen: boolean, reason?: string) {
  await db.transaction(async tx => {
    await tx.update(demoSettingsTable).set({ frozen }).where(eq(demoSettingsTable.id, "platform"));
    await tx.insert(demoAuditTable).values({ action: `Demo global freeze ${frozen ? "enabled" : "lifted"}${reason?.trim() ? ` · ${reason.trim()}` : ""}` });
  });
  return { frozen };
}

type RequestRow = typeof demoRequestsTable.$inferSelect;
const requestTransaction = (r: RequestRow) => ({
  id: r.id, type: r.kind, account: r.kind === "Deposit" ? "deposit" : "grant", direction: r.kind === "Deposit" ? "in" : "out",
  amount: r.amountCents / 100, description: r.note || `${r.kind} request`, status: r.status, createdAt: r.createdAt.toISOString(),
});

/** Grant balance minus withdrawals still awaiting review. */
async function availableCents(profile: DemoProfile, tx: Pick<typeof db, "select"> = db) {
  const [row] = await tx.select({ sum: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}), 0)::int` }).from(demoRequestsTable)
    .where(and(eq(demoRequestsTable.profileId, profile.id), eq(demoRequestsTable.kind, "Withdrawal"), eq(demoRequestsTable.status, "Pending")));
  return Math.max(0, profile.grantCents - (row?.sum ?? 0));
}

export async function applicantAccount() {
  const person = await getUser(demoApplicantId);
  const [profile] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, demoApplicantId));
  if (!person || !profile) throw new Error("Demo applicant is missing");
  const [settings] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  const ledger = await db.select().from(demoLedgerTable).where(eq(demoLedgerTable.profileId, demoApplicantId)).orderBy(desc(demoLedgerTable.createdAt)).limit(100);
  const requests = await db.select().from(demoRequestsTable).where(eq(demoRequestsTable.profileId, demoApplicantId)).orderBy(desc(demoRequestsTable.createdAt)).limit(100);
  const transactions = [
    ...ledger.map(l => ({
      id: l.id, type: "Top-up", account: l.account, direction: "in", amount: l.amountCents / 100,
      description: l.reason, status: "Completed", createdAt: l.createdAt.toISOString(),
    })),
    ...requests.map(requestTransaction),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    status: person.status, platformFrozen: settings?.frozen ?? false, tier: person.tier, verificationLevel: person.verificationLevel,
    permissions: person.permissions, balances: person.balances, availableToWithdraw: (await availableCents(profile)) / 100,
    cards: person.cards, transactions,
  };
}

export async function createApplicantRequest(kind: "Deposit" | "Withdrawal", amount: number, note = "") {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000000 || Math.abs(amount * 100 - cents) > 0.00001) throw new DemoInputError("Enter an amount between $0.01 and $1,000,000 with at most two decimals.");
  return db.transaction(async tx => {
    const [settings] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    if (settings?.frozen) throw new DemoInputError("Deposits and withdrawals are paused while the platform is frozen.");
    const [profile] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, demoApplicantId)).for("update");
    if (!profile) throw new Error("Demo applicant is missing");
    if (profile.status === "Frozen") throw new DemoInputError("Your account is frozen. Contact support to make changes.");
    const perms = (profile.permissions ?? {}) as { withdrawalKycRequired?: boolean; depositKycRequired?: boolean };
    const kycNeeded = kind === "Withdrawal" ? perms.withdrawalKycRequired : perms.depositKycRequired;
    if (kycNeeded && profile.verificationLevel !== "Verified") throw new DemoInputError(`Identity verification is required before you can submit a ${kind.toLowerCase()}.`);
    if (kind === "Withdrawal" && cents > await availableCents(profile, tx)) throw new DemoInputError("This is more than your available grant balance, after pending withdrawals.");
    const [row] = await tx.insert(demoRequestsTable).values({ profileId: profile.id, kind, amountCents: cents, note: note.trim().slice(0, 240) }).returning();
    await tx.insert(demoAuditTable).values({ profileId: profile.id, actor: "Demo applicant", action: `${kind} request submitted +$${(cents / 100).toFixed(2)}` });
    return requestTransaction(row!);
  });
}
