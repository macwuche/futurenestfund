/**
 * Tiers (Step 9.4), the database side: the rules set in Admin Settings → Tiers, the applicant's "Your tier" page, upgrade
 * requests (the user fills in the next tier's form; an administrator approves or declines), and the prompt a user gets when
 * a tier limit stops a withdrawal or a card top-up. The rules themselves are in tierRules.ts.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, demoAuditTable, demoFilesTable, demoLedgerTable, demoNotificationsTable, demoProfilesTable, demoSettingsTable, demoTierRequestsTable, type DemoTierRequest } from "@workspace/db";
import { applicantCardTypes, CARD_TYPES, loadCardTypes } from "./cardTypes";
import { DemoInputError } from "./demoWorkspace";
import { notifyUser } from "./notifications";
import { parseAnswers, type MethodField } from "./paymentRules";
import { filesByField, readAnswers } from "./planApplications";
import { RecordInputError } from "./applicantRecords";
import {
  cardAllowed, describeTier, nextTier, tierNeededFor, parseTierRules, storedTierRules, tierOf, tierWarnings, TierLimitError, TIERS, type Tier, type TierRule, type TierRules, type UpgradeForm,
} from "./tierRules";
import { fileUrl, removeFile, storeUpload, UploadError, type StoredFile } from "./uploads";
import { limitsOut } from "./withdrawalLimits";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function loadTierRules(tx: Reader = db): Promise<TierRules> {
  const [s] = await tx.select({ tierRules: demoSettingsTable.tierRules, max: demoSettingsTable.withdrawalMaxCents, daily: demoSettingsTable.withdrawalDailyCents })
    .from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  return storedTierRules(s?.tierRules, { withdrawalMaxCents: s?.max ?? null, withdrawalDailyCents: s?.daily ?? null });
}
/** The rules from an already-read settings row (approvals and requests lock that row first). */
export const rulesOfSettings = (s: { tierRules: unknown; withdrawalMaxCents: number | null; withdrawalDailyCents: number | null } | undefined) =>
  storedTierRules(s?.tierRules, { withdrawalMaxCents: s?.withdrawalMaxCents ?? null, withdrawalDailyCents: s?.withdrawalDailyCents ?? null });

/* ---------- API shapes ---------- */

const cardsOut = (r: TierRule) => CARD_TYPES.map(c => ({ key: c.key, name: c.name, virtual: r.cards[c.key].virtual, physical: r.cards[c.key].physical }));
const formOut = (f: UpgradeForm) => ({ intro: f.intro, fields: f.fields });
const tierOut = (t: Tier, r: TierRule) => ({
  tier: t,
  withdrawal: limitsOut({ maxCents: r.withdrawalMaxCents, dailyCents: r.withdrawalDailyCents }),
  topUp: limitsOut({ maxCents: r.topUpMaxCents, dailyCents: r.topUpDailyCents }),
  cards: cardsOut(r),
});

export async function adminTierSettings() {
  const [rules, cards] = await Promise.all([loadTierRules(), loadCardTypes()]);
  return {
    tiers: TIERS.map(t => ({ ...tierOut(t, rules[t]), upgradeForm: rules[t].upgradeForm ? formOut(rules[t].upgradeForm!) : null })),
    warnings: tierWarnings(rules, cards),
  };
}

export async function changeTierSettings(input: unknown, actor: string) {
  await db.transaction(async tx => {
    const [row] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    const current = rulesOfSettings(row);
    const next = parseTierRules(input, current);
    if (typeof next === "string") throw new DemoInputError(next);
    const changed = TIERS.filter(t => JSON.stringify(next[t]) !== JSON.stringify(current[t]));
    // Saved even when nothing changed, so a database still on the old platform-wide columns gets its own tier rules.
    await tx.update(demoSettingsTable).set({ tierRules: next }).where(eq(demoSettingsTable.id, "platform"));
    if (changed.length) await tx.insert(demoAuditTable).values({ actor, action: `Tier rules updated: ${changed.map(t => describeTier(t, next[t])).join(" | ")}` });
  });
  return adminTierSettings();
}

/* ---------- answers and files ---------- */

const answersOf = (r: Pick<DemoTierRequest, "answers">) => ((r.answers as Record<string, string> | null) ?? {});
const snapshotOf = (r: Pick<DemoTierRequest, "formSnapshot">) => r.formSnapshot as UpgradeForm;

async function requestFiles(ids: string[]) {
  if (!ids.length) return new Map<string, StoredFile>();
  const rows = await db.select().from(demoFilesTable).where(inArray(demoFilesTable.applicationId, ids));
  return new Map(rows.map(f => [f.id, f]));
}

function answersView(r: DemoTierRequest, files: Map<string, StoredFile>, scope: "admin" | "applicant") {
  const answers = answersOf(r);
  return snapshotOf(r).fields.map(f => {
    const v = answers[f.id];
    const base = { fieldId: f.id, label: f.label, type: f.type, required: f.required };
    if (f.type !== "file") return { ...base, value: v ?? "" };
    const file = v ? files.get(v) : undefined;
    return {
      ...base, value: file?.originalName ?? "",
      ...(file ? { file: { id: file.id, name: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, url: fileUrl(scope, file.id), uploadedAt: file.createdAt.toISOString() } } : {}),
    };
  });
}

function requestOut(r: DemoTierRequest, files: Map<string, StoredFile>, scope: "admin" | "applicant") {
  return {
    id: r.id, fromTier: r.fromTier, toTier: r.toTier, status: r.status as "Pending" | "Approved" | "Declined",
    submittedAt: r.createdAt.toISOString(),
    ...(r.decidedAt ? { decidedAt: r.decidedAt.toISOString() } : {}),
    ...(r.decisionNote ? { decisionNote: r.decisionNote } : {}),
    intro: snapshotOf(r).intro,
    answers: answersView(r, files, scope),
  };
}

/* ---------- applicant ---------- */

export async function applicantTier(profileId: string) {
  const [profile] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId));
  if (!profile) return undefined;
  const rules = await loadTierRules();
  const tier = tierOf(profile.tier);
  const up = nextTier(rules, tier);
  const [latest] = await db.select().from(demoTierRequestsTable).where(eq(demoTierRequestsTable.profileId, profileId)).orderBy(desc(demoTierRequestsTable.createdAt)).limit(1);
  // An old approval for a tier the user has since left (an admin moved them) isn't news any more.
  const request = latest && !(latest.status === "Approved" && latest.toTier !== tier) ? latest : undefined;
  return {
    tier,
    customWithdrawalLimits: profile.withdrawalLimitCustom,
    tiers: TIERS.map(t => tierOut(t, rules[t])),
    next: up ? { tier: up, ...formOut(rules[up].upgradeForm!) } : null,
    request: request ? requestOut(request, await requestFiles([request.id]), "applicant") : null,
  };
}

/** Submit the next tier's upgrade form. One open request at a time; one tier at a time. */
export async function submitTierRequest(profileId: string, input: { answers: unknown; fileFields?: unknown; files?: Express.Multer.File[] }) {
  const [profile] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId));
  if (!profile) throw new Error(`Applicant ${profileId} is missing`);
  const rules = await loadTierRules();
  const from = tierOf(profile.tier);
  const to = nextTier(rules, from);
  if (!to) throw new RecordInputError(from >= 3 ? "Your account is already on the highest tier." : `Upgrades to Tier ${from + 1} aren't open yet. Contact support if you need higher limits.`);
  const form = rules[to].upgradeForm!;
  const [open] = await db.select({ id: demoTierRequestsTable.id }).from(demoTierRequestsTable)
    .where(and(eq(demoTierRequestsTable.profileId, profileId), eq(demoTierRequestsTable.status, "Pending")));
  if (open) throw new RecordInputError("Your upgrade request is already being reviewed. We'll let you know as soon as it's decided.");
  const answers = parseAnswers(form.fields, readAnswers(input.answers));
  if (typeof answers === "string") throw new RecordInputError(answers);
  const files = filesByField(form.fields, input.files, input.fileFields);
  for (const f of form.fields) if (f.type === "file" && f.required && !files.has(f.id)) throw new RecordInputError(`Attach "${f.label}".`);

  const id = randomUUID();
  const stored = await storeFiles(profileId, id, form.fields, files);
  try {
    await db.transaction(async tx => {
      const [locked] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId)).for("update");
      if (!locked || tierOf(locked.tier) !== from) throw new RecordInputError("Your tier changed while you were filling in the form. Reload the page and try again.");
      await tx.insert(demoTierRequestsTable).values({ id, profileId, fromTier: from, toTier: to, formSnapshot: form, answers: { ...answers, ...Object.fromEntries(stored) } });
      await tx.insert(demoAuditTable).values({ profileId, actor: locked.name, action: `Tier ${to} upgrade requested (from Tier ${from})` });
      await notifyUser(profileId, `Your Tier ${to} upgrade request was sent. We'll let you know when it's reviewed.`, "/tier", tx);
    });
  } catch (err) {
    await dropFiles([...stored.values()]);
    // Two submissions at once: the unique index lets only one through.
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.cause?.code ?? e.code) === "23505") throw new RecordInputError("Your upgrade request is already being reviewed. We'll let you know as soon as it's decided.");
    throw err;
  }
  return applicantTier(profileId);
}

async function storeFiles(profileId: string, requestId: string, fields: MethodField[], files: Map<string, Express.Multer.File>) {
  const stored = new Map<string, string>();
  try {
    for (const f of fields) {
      const file = files.get(f.id);
      if (!file) continue;
      try {
        stored.set(f.id, await storeUpload(profileId, "tier", file, async s => s.id, requestId));
      } catch (err) {
        if (err instanceof UploadError) throw new UploadError(`"${f.label}": ${err.message}`);
        throw err;
      }
    }
  } catch (err) {
    await dropFiles([...stored.values()]);
    throw err;
  }
  return stored;
}
const dropFiles = (ids: string[]) => Promise.all(ids.map(id => removeFile(id).catch(() => {})));

/* ---------- admin ---------- */

async function withUsers(rows: DemoTierRequest[]) {
  const ids = [...new Set(rows.map(r => r.profileId))];
  const people = ids.length ? await db.select().from(demoProfilesTable).where(inArray(demoProfilesTable.id, ids)) : [];
  const byId = new Map(people.map(p => [p.id, p]));
  const files = await requestFiles(rows.map(r => r.id));
  return rows.map(r => {
    const p = byId.get(r.profileId);
    return {
      ...requestOut(r, files, "admin"),
      ...(r.decidedBy ? { decidedBy: r.decidedBy } : {}),
      user: {
        id: r.profileId, name: p?.name ?? "Unknown user", email: p?.email ?? "", tier: p?.tier ?? r.fromTier,
        verificationLevel: (p?.verificationLevel ?? "Unsubmitted") as "Verified" | "Pending" | "Rejected" | "Unsubmitted",
        ...(p?.avatarFileId ? { avatarUrl: fileUrl("admin", p.avatarFileId) } : {}),
      },
    };
  });
}

export async function listTierRequests(status: "pending" | "decided") {
  const pending = status === "pending";
  const rows = await db.select().from(demoTierRequestsTable)
    .where(pending ? eq(demoTierRequestsTable.status, "Pending") : sql`${demoTierRequestsTable.status} <> 'Pending'`)
    .orderBy(pending ? asc(demoTierRequestsTable.createdAt) : desc(demoTierRequestsTable.decidedAt)).limit(pending ? 200 : 50);
  return withUsers(rows);
}

export async function countTierRequests() {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(demoTierRequestsTable).where(eq(demoTierRequestsTable.status, "Pending"));
  return r?.n ?? 0;
}

/** Approve (the user moves up to the requested tier) or decline with a reason the user sees. */
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function decideTierRequest(id: string, decision: "approve" | "decline", note: string, actor: string) {
  if (!isUuid(id)) return false;
  const text = note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
  if (decision === "decline" && text.length < 5) throw new DemoInputError("Give the user a reason of at least five characters.");
  const found = await db.transaction(async (tx: Tx) => {
    const [r] = await tx.select().from(demoTierRequestsTable).where(eq(demoTierRequestsTable.id, id)).for("update");
    if (!r) return false;
    if (r.status !== "Pending") throw new DemoInputError(`This request was already ${r.status.toLowerCase()}${r.decidedBy ? ` by ${r.decidedBy}` : ""}.`);
    const [profile] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, r.profileId)).for("update");
    if (!profile) return false;
    if (decision === "approve" && tierOf(profile.tier) !== r.fromTier) {
      throw new DemoInputError(`This user is on Tier ${profile.tier} now, not Tier ${r.fromTier} as when they asked. Decline this request, or change their tier in their profile.`);
    }
    const approved = decision === "approve";
    await tx.update(demoTierRequestsTable).set({ status: approved ? "Approved" : "Declined", decisionNote: text || null, decidedBy: actor, decidedAt: new Date() }).where(eq(demoTierRequestsTable.id, id));
    if (approved) await tx.update(demoProfilesTable).set({ tier: r.toTier }).where(eq(demoProfilesTable.id, r.profileId));
    await tx.insert(demoAuditTable).values({ profileId: r.profileId, actor, action: approved ? `Tier ${r.toTier} upgrade approved (was Tier ${r.fromTier})${text ? `: ${text}` : ""}` : `Tier ${r.toTier} upgrade declined: ${text}` });
    await notifyUser(r.profileId, approved
      ? `Your account is now Tier ${r.toTier}. Its limits and cards apply straight away.${text ? ` Note: ${text}` : ""}`
      : `Your Tier ${r.toTier} upgrade wasn't approved: ${text}. You can send the form again.`,
    "/tier", tx, { kind: approved ? "tier_upgrade_approved" : "tier_upgrade_declined", data: { tier: r.fromTier, nextTier: r.toTier, ...(text ? { reason: text } : {}) } });
    return true;
  });
  return found;
}

/* ---------- limits ---------- */

/** Card top-ups into this user's card account in the last 24 hours (an admin's top-ups count too). */
export async function toppedUpLast24h(profileId: string, tx: Reader = db) {
  const [r] = await tx.select({ sum: sql<number>`coalesce(sum(${demoLedgerTable.amountCents}), 0)::int` }).from(demoLedgerTable)
    .where(and(eq(demoLedgerTable.profileId, profileId), eq(demoLedgerTable.kind, "Card top-up"), eq(demoLedgerTable.account, "card"),
      gt(demoLedgerTable.amountCents, 0), gt(demoLedgerTable.createdAt, sql`now() - interval '24 hours'`)));
  return r?.sum ?? 0;
}

/**
 * The refusal for a request over a tier limit. With a higher tier open for upgrade, the message says how to reach it,
 * and `upgradeTier` lets the app show an Upgrade button. `ownLimits` (an admin set custom limits for this user): upgrading
 * wouldn't change them, so no upgrade is offered.
 */
export function tierLimitError(rules: TierRules, tier: number, message: string, blocked: string, ownLimits = false) {
  const up = ownLimits ? null : nextTier(rules, tier);
  return new TierLimitError(up ? `${message} Upgrade to Tier ${up} to raise your limits.` : message, up, blocked);
}

/**
 * After a tier limit refused a request (the refusal itself rolled back): tell the user in the bell, with an email that
 * opens the upgrade page. At most once a day, so trying again doesn't fill their inbox.
 */
export async function promptTierUpgrade(profileId: string, tier: number, err: TierLimitError) {
  if (!err.upgradeTier) return;
  const [recent] = await db.select({ id: demoNotificationsTable.id }).from(demoNotificationsTable)
    .where(and(eq(demoNotificationsTable.profileId, profileId), eq(demoNotificationsTable.emailKind, "tier_upgrade_needed"), gt(demoNotificationsTable.createdAt, sql`now() - interval '24 hours'`)))
    .limit(1);
  if (recent) return;
  await notifyUser(profileId, `We couldn't complete ${err.blocked ?? "your request"}: it's above your Tier ${tier} limit. Upgrade to Tier ${err.upgradeTier} to raise your limits.`,
    "/tier", db, { kind: "tier_upgrade_needed", data: { tier, nextTier: err.upgradeTier, ...(err.blocked ? { blocked: err.blocked } : {}) } });
}

export { usd as tierUsd, TierLimitError };

/** The cards on sale (Settings → Cards), each kind the user's tier can't buy marked with the tier that can. */
export async function applicantCardTypesFor(profileId: string) {
  const [rules, [p]] = await Promise.all([
    loadTierRules(), db.select({ tier: demoProfilesTable.tier }).from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId)),
  ]);
  const tier = tierOf(p?.tier);
  return (await applicantCardTypes()).map(t => ({
    ...t,
    ...(t.virtual && !cardAllowed(rules, tier, t.key, "Virtual") ? { virtualLock: { tierNeeded: tierNeededFor(rules, tier, t.key, "Virtual") } } : {}),
    ...(t.physical && !cardAllowed(rules, tier, t.key, "Physical") ? { physicalLock: { tierNeeded: tierNeededFor(rules, tier, t.key, "Physical") } } : {}),
  }));
}

export async function tierRequestForAdmin(id: string) {
  const rows = await db.select().from(demoTierRequestsTable).where(eq(demoTierRequestsTable.id, id));
  return (await withUsers(rows))[0];
}
