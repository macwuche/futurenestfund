import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import {
  db, demoApplicationsTable, demoApplicationEventsTable, demoMilestonesTable, demoProfilesTable, demoAuditTable, demoFilesTable,
} from "@workspace/db";
import { notifyUser } from "./notifications";
import { fileUrl, findFile, removeFile, storeUpload, type StoredFile } from "./uploads";

/** Thrown for requests the user can fix; the app's error handler turns it into a 400. */
export class RecordInputError extends Error {}

type AppRow = typeof demoApplicationsTable.$inferSelect;
const WITHDRAWABLE = ["Submitted", "Review", "Changes requested"];
/** Documents can be added or removed until a decision is made. */
const ATTACHABLE = WITHDRAWABLE;
const MAX_DOCUMENTS = 5;

export const applicationSummary = (a: AppRow) => ({
  id: a.id, title: a.title, category: a.category, status: a.status, amount: a.amountCents / 100, submittedAt: a.submittedAt.toISOString(),
});

const toCents = (amount: number) => {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 10000 || cents > 1000000000 || Math.abs(amount * 100 - cents) > 0.00001) {
    throw new RecordInputError("Enter an amount between $100 and $10,000,000 with at most two decimals.");
  }
  return cents;
};

export async function listApplications(profileId: string) {
  const rows = await db.select().from(demoApplicationsTable).where(eq(demoApplicationsTable.profileId, profileId)).orderBy(desc(demoApplicationsTable.submittedAt));
  return rows.map(applicationSummary);
}

export async function applicationDetail(profileId: string, id: string) {
  const [a] = await db.select().from(demoApplicationsTable).where(and(eq(demoApplicationsTable.id, id), eq(demoApplicationsTable.profileId, profileId)));
  if (!a) return undefined;
  const events = await db.select().from(demoApplicationEventsTable).where(eq(demoApplicationEventsTable.applicationId, id)).orderBy(asc(demoApplicationEventsTable.createdAt));
  const files = await db.select().from(demoFilesTable)
    .where(and(eq(demoFilesTable.applicationId, id), eq(demoFilesTable.profileId, profileId))).orderBy(asc(demoFilesTable.createdAt));
  return {
    ...applicationSummary(a),
    updatedAt: a.updatedAt.toISOString(),
    canWithdraw: WITHDRAWABLE.includes(a.status),
    canRespond: a.status === "Changes requested",
    canAttach: ATTACHABLE.includes(a.status),
    documents: files.map(storedDocument),
    events: events.map(e => ({ id: e.id, status: e.status, note: e.note, actor: e.actor, createdAt: e.createdAt.toISOString() })),
  };
}

async function actorName(profileId: string) {
  const [p] = await db.select({ name: demoProfilesTable.name }).from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId));
  return p?.name ?? "Applicant";
}

export async function createApplication(profileId: string, input: { title: string; category: string; amount: number }) {
  const title = input.title.trim();
  if (title.length < 3) throw new RecordInputError("Enter a title of at least 3 characters.");
  const cents = toCents(input.amount);
  const id = `APP-${randomUUID().slice(0, 8).toUpperCase()}`;
  const actor = await actorName(profileId);
  await db.transaction(async tx => {
    await tx.insert(demoApplicationsTable).values({ id, profileId, title, category: input.category.trim(), amountCents: cents });
    await tx.insert(demoApplicationEventsTable).values({ applicationId: id, status: "Submitted", note: "Application submitted", actor });
    await tx.insert(demoAuditTable).values({ profileId, actor, action: `Application ${id} submitted` });
    await notifyUser(profileId, `Application "${title}" submitted`, `/applications/${id}`, tx);
  });
  return (await applicationDetail(profileId, id))!;
}

export async function withdrawApplication(profileId: string, id: string) {
  const actor = await actorName(profileId);
  const done = await db.transaction(async tx => {
    const [a] = await tx.select().from(demoApplicationsTable).where(and(eq(demoApplicationsTable.id, id), eq(demoApplicationsTable.profileId, profileId))).for("update");
    if (!a) return false;
    if (!WITHDRAWABLE.includes(a.status)) throw new RecordInputError(`An application that is ${a.status.toLowerCase()} can't be withdrawn.`);
    await tx.update(demoApplicationsTable).set({ status: "Withdrawn", updatedAt: new Date() }).where(eq(demoApplicationsTable.id, id));
    await tx.insert(demoApplicationEventsTable).values({ applicationId: id, status: "Withdrawn", note: "Withdrawn by applicant", actor });
    await tx.insert(demoAuditTable).values({ profileId, actor, action: `Application ${id} withdrawn` });
    await notifyUser(profileId, `Application "${a.title}" withdrawn`, `/applications/${id}`, tx);
    return true;
  });
  return done ? (await applicationDetail(profileId, id))! : undefined;
}

export async function respondToApplication(profileId: string, id: string, input: { note: string; amount?: number }) {
  const note = input.note.trim();
  if (note.length < 5) throw new RecordInputError("Write a reply of at least 5 characters.");
  const cents = input.amount === undefined ? undefined : toCents(input.amount);
  const actor = await actorName(profileId);
  const done = await db.transaction(async tx => {
    const [a] = await tx.select().from(demoApplicationsTable).where(and(eq(demoApplicationsTable.id, id), eq(demoApplicationsTable.profileId, profileId))).for("update");
    if (!a) return false;
    if (a.status !== "Changes requested") throw new RecordInputError("Only applications with requested changes can be resubmitted.");
    await tx.update(demoApplicationsTable).set({ status: "Submitted", updatedAt: new Date(), ...(cents === undefined ? {} : { amountCents: cents }) }).where(eq(demoApplicationsTable.id, id));
    const amountNote = cents !== undefined && cents !== a.amountCents ? ` Amount revised to $${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}.` : "";
    await tx.insert(demoApplicationEventsTable).values({ applicationId: id, status: "Submitted", note: `Resubmitted: ${note}${amountNote}`, actor });
    await tx.insert(demoAuditTable).values({ profileId, actor, action: `Application ${id} resubmitted` });
    await notifyUser(profileId, `Application "${a.title}" resubmitted`, `/applications/${id}`, tx);
    return true;
  });
  return done ? (await applicationDetail(profileId, id))! : undefined;
}

const storedDocument = (f: StoredFile) => ({
  id: f.id, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, url: fileUrl("applicant", f.id), uploadedAt: f.createdAt.toISOString(),
});

async function ownedApplication(profileId: string, id: string) {
  const [a] = await db.select().from(demoApplicationsTable).where(and(eq(demoApplicationsTable.id, id), eq(demoApplicationsTable.profileId, profileId)));
  return a;
}

/** Attach a proposal document. Status and the per-application limit are checked again under a row lock. */
export async function attachApplicationDocument(profileId: string, id: string, file: Express.Multer.File | undefined) {
  const a = await ownedApplication(profileId, id);
  if (!a) return undefined;
  if (!ATTACHABLE.includes(a.status)) throw new RecordInputError(`Documents can't be added to an application that is ${a.status.toLowerCase()}.`);
  const actor = await actorName(profileId);
  await storeUpload(profileId, "proposal", file, async (stored, tx) => {
    const [locked] = await tx.select().from(demoApplicationsTable).where(eq(demoApplicationsTable.id, id)).for("update");
    if (!locked || !ATTACHABLE.includes(locked.status)) throw new RecordInputError("This application can no longer be changed.");
    // Includes the row just inserted for this upload, hence `>`.
    const existing = await tx.select({ id: demoFilesTable.id }).from(demoFilesTable).where(eq(demoFilesTable.applicationId, id));
    if (existing.length > MAX_DOCUMENTS) throw new RecordInputError(`An application can have at most ${MAX_DOCUMENTS} documents.`);
    await tx.update(demoApplicationsTable).set({ updatedAt: new Date() }).where(eq(demoApplicationsTable.id, id));
    await tx.insert(demoAuditTable).values({ profileId, actor, action: `Document "${stored.originalName}" attached to ${id}` });
  }, id);
  return applicationDetail(profileId, id);
}

export async function removeApplicationDocument(profileId: string, id: string, fileId: string) {
  const a = await ownedApplication(profileId, id);
  const f = a ? await findFile(fileId, profileId) : undefined;
  if (!a || !f || f.applicationId !== id) return undefined;
  if (!ATTACHABLE.includes(a.status)) throw new RecordInputError(`Documents can't be removed from an application that is ${a.status.toLowerCase()}.`);
  await db.insert(demoAuditTable).values({ profileId, actor: await actorName(profileId), action: `Document "${f.originalName}" removed from ${id}` });
  await removeFile(f.id);
  return applicationDetail(profileId, id);
}

/** Applications that count toward totals (withdrawn ones are kept for history but excluded). */
export const activeApplicationsFilter = ne(demoApplicationsTable.status, "Withdrawn");

/* ---------- milestones ---------- */
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
type MsRow = typeof demoMilestonesTable.$inferSelect;
const milestone = (m: MsRow) => ({ id: m.id, title: m.title, grant: m.grant, due: m.due, done: m.done });

export async function listMilestones(profileId: string) {
  const rows = await db.select().from(demoMilestonesTable).where(eq(demoMilestonesTable.profileId, profileId)).orderBy(asc(demoMilestonesTable.due));
  return rows.map(milestone);
}
export async function createMilestone(profileId: string, input: { title: string; grant: string; due: string }) {
  const title = input.title.trim();
  if (title.length < 3) throw new RecordInputError("Enter a milestone of at least 3 characters.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.due) || isNaN(Date.parse(input.due))) throw new RecordInputError("Choose a valid due date.");
  const [row] = await db.insert(demoMilestonesTable).values({ profileId, title, grant: input.grant.trim(), due: input.due }).returning();
  return milestone(row!);
}
export async function setMilestoneDone(profileId: string, id: string, done: boolean) {
  if (!isUuid(id)) return undefined;
  const [row] = await db.update(demoMilestonesTable).set({ done }).where(and(eq(demoMilestonesTable.id, id), eq(demoMilestonesTable.profileId, profileId))).returning();
  return row ? milestone(row) : undefined;
}
export async function deleteMilestone(profileId: string, id: string) {
  if (!isUuid(id)) return false;
  const rows = await db.delete(demoMilestonesTable).where(and(eq(demoMilestonesTable.id, id), eq(demoMilestonesTable.profileId, profileId))).returning({ id: demoMilestonesTable.id });
  return rows.length > 0;
}
