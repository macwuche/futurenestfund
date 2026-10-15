import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db, demoProfilesTable, demoAuditTable, demoLedgerTable, demoSettingsTable, type DemoProfile } from "@workspace/db";
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
  const labels = monthly ? ["May", "Jun", "Jul", "Aug", "Sep", "Oct"] : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const submitted = monthly ? [12, 17, 15, 24, 22, 32] : [12, 21, 15, 28, 23, 18, 30];
  const review = monthly ? [8, 11, 10, 16, 14, 21] : [8, 12, 9, 18, 16, 11, 20];
  return {
    profile: applicantProfile(person),
    totalBudget: 50000, allocatedFunds: person.grantCents / 100, remainingFunds: 50000 - person.grantCents / 100,
    fundingTrend: labels.map((label, index) => ({ label, submitted: submitted[index], review: review[index] })),
    setupCards: [
      { id: "matchmaking", title: "Find your perfect grant match", description: "Tell us a little about your goals. Discover funding opportunities that fit your vision.", actionLabel: "Complete Setup", complete: false },
      { id: "proposal", title: "Your next big idea starts here", description: "Upload your proposal and get ready to turn your ambitions into meaningful impact.", actionLabel: "Complete Setup", complete: false },
    ],
    highlights: applications,
    recommendations: [
      { id: "grant-tech", title: "Digital Impact Fellowship", category: "Technology", amount: 30000, deadline: "2026-11-30", recommended: true },
      { id: "grant-community", title: "Community Builders Fund", category: "Community", amount: 15000, deadline: "2026-12-15", recommended: true },
      { id: "grant-green", title: "Climate Action Accelerator", category: "Environment", amount: 50000, deadline: "2026-12-01", recommended: false },
    ],
    applicationCount: applications.length,
  };
}

export async function adminDashboard() {
  const people = await db.select().from(demoProfilesTable);
  const activity = await db.select().from(demoAuditTable).orderBy(desc(demoAuditTable.createdAt)).limit(8);
  const [settings] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  return {
    totalUsers: people.length, activeUsers: people.filter(p => p.status === "Active").length,
    pendingApplications: applications.filter(a => a.status === "Review" || a.status === "Submitted").length,
    pendingKyc: people.filter(p => p.verificationLevel === "Pending").length,
    pendingDeposits: 0, pendingWithdrawals: 0,
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
