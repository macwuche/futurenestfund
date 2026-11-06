/**
 * Applying to a grant plan (Phase 11). The applicant fills in the plan's own form (file fields as uploads). Submitting
 * charges nothing: the application fee is worked out now and charged from the account balance only when an
 * administrator approves (adminOps.decideApplication), even below $0.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, demoApplicationsTable, demoApplicationEventsTable, demoAuditTable, demoProfilesTable } from "@workspace/db";
import { notifyUser } from "./notifications";
import { RecordInputError, applicationDetail } from "./applicantRecords";
import { ALL_INDUSTRIES, findPlan, planFee, planFields } from "./grantPlans";
import { industryNames } from "./industries";
import { feeCents } from "./fees";
import { parseAnswers, usd, type MethodField } from "./paymentRules";
import { planInitials } from "./grantPlanRules";
import { answersOf, snapshotOf, type PlanSnapshot } from "./planAnswers";
import { removeFile, storeUpload, UploadError } from "./uploads";

/**
 * The uploads by field id. Files come as `files` (in order) with `fileFields`, a JSON list naming the field each one is
 * for; anything not for one of the plan's file fields is refused.
 */
export function filesByField(fields: MethodField[], files: Express.Multer.File[] = [], fileFieldsRaw?: unknown) {
  const fileFields = new Map(fields.filter(f => f.type === "file").map(f => [f.id, f]));
  const uploads = files.filter(f => f.fieldname === "files");
  if (uploads.length !== files.length) throw new RecordInputError("The application form could not be read. Reload the page and try again.");
  let ids: unknown = [];
  if (typeof fileFieldsRaw === "string" && fileFieldsRaw.trim()) { try { ids = JSON.parse(fileFieldsRaw); } catch { ids = null; } }
  if (!Array.isArray(ids) || ids.length !== uploads.length) throw new RecordInputError("The files couldn't be matched to the form. Reload the page and try again.");
  const out = new Map<string, Express.Multer.File>();
  for (const [i, file] of uploads.entries()) {
    const id = ids[i];
    if (typeof id !== "string" || !fileFields.has(id)) throw new RecordInputError("A file was sent for a field this form doesn't have. Reload the page and try again.");
    if (out.has(id)) throw new RecordInputError(`Attach one file for "${fileFields.get(id)!.label}".`);
    if (file.size > 0) out.set(id, file);
  }
  return out;
}

/** The answers as sent: a JSON object (multipart sends it as a string). */
export function readAnswers(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try { return JSON.parse(raw); } catch { throw new RecordInputError("The form answers couldn't be read. Reload the page and try again."); }
}

async function actorName(profileId: string) {
  const [p] = await db.select({ name: demoProfilesTable.name }).from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId));
  return p?.name ?? "Applicant";
}

/** Store each new file against the application; on any failure, the ones already stored are removed again. */
async function storeAnswerFiles(profileId: string, applicationId: string, fields: MethodField[], files: Map<string, Express.Multer.File>) {
  const stored = new Map<string, string>();
  try {
    for (const f of fields) {
      const file = files.get(f.id);
      if (!file) continue;
      try {
        stored.set(f.id, await storeUpload(profileId, "application", file, async s => s.id, applicationId));
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

export async function createPlanApplication(profileId: string, input: { planId: unknown; answers: unknown; fileFields?: unknown; files?: Express.Multer.File[] }) {
  const plan = typeof input.planId === "string" ? await findPlan(input.planId) : undefined;
  if (!plan || !plan.enabled) throw new RecordInputError("This grant plan isn't open for applications any more.");
  const fields = planFields(plan);
  const answers = parseAnswers(fields, readAnswers(input.answers));
  if (typeof answers === "string") throw new RecordInputError(answers);
  const files = filesByField(fields, input.files, input.fileFields);
  for (const f of fields) if (f.type === "file" && f.required && !files.has(f.id)) throw new RecordInputError(`Attach "${f.label}".`);

  const industry = plan.industryId ? (await industryNames([plan.industryId])).get(plan.industryId) ?? "Unknown industry" : ALL_INDUSTRIES;
  const fee = planFee(plan);
  const snapshot: PlanSnapshot = {
    planId: plan.id, name: plan.name, description: plan.description, industry, amountCents: plan.amountCents, fee, initials: planInitials(plan.name), fields,
  };
  const feeAmount = feeCents(fee, plan.amountCents);
  const id = `APP-${randomUUID().slice(0, 8).toUpperCase()}`;
  const actor = await actorName(profileId);
  const stored = await storeAnswerFiles(profileId, id, fields, files);
  try {
    await db.transaction(async tx => {
      await tx.insert(demoApplicationsTable).values({
        id, profileId, title: plan.name, category: industry, amountCents: plan.amountCents,
        planId: plan.id, planSnapshot: snapshot, answers: { ...answers, ...Object.fromEntries(stored) }, feeCents: feeAmount,
      });
      await tx.insert(demoApplicationEventsTable).values({ applicationId: id, status: "Submitted", note: "Application submitted", actor });
      await tx.insert(demoAuditTable).values({ profileId, actor, action: `Application ${id} submitted for "${plan.name}" (${usd(plan.amountCents)}${feeAmount ? `, application fee ${usd(feeAmount)} on approval` : ""})` });
      await notifyUser(profileId, `Application for "${plan.name}" submitted`, `/applications/${id}`, tx);
    });
  } catch (err) {
    await dropFiles([...stored.values()]);
    throw err;
  }
  return (await applicationDetail(profileId, id))!;
}

/**
 * After "Changes requested": the applicant edits their answers and may replace files (a file field left empty keeps the
 * file already attached), then the application goes back to Submitted.
 */
export async function resubmitPlanApplication(profileId: string, id: string, input: { note?: unknown; answers: unknown; fileFields?: unknown; files?: Express.Multer.File[] }) {
  const [a] = await db.select().from(demoApplicationsTable).where(and(eq(demoApplicationsTable.id, id), eq(demoApplicationsTable.profileId, profileId)));
  if (!a) return undefined;
  const snap = snapshotOf(a);
  if (!snap) throw new RecordInputError("This application has no form to edit. Reply with a note instead.");
  if (a.status !== "Changes requested") throw new RecordInputError("Only applications with requested changes can be edited and resubmitted.");
  const note = typeof input.note === "string" ? input.note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 1000) : "";
  const answers = parseAnswers(snap.fields, readAnswers(input.answers));
  if (typeof answers === "string") throw new RecordInputError(answers);
  const files = filesByField(snap.fields, input.files, input.fileFields);
  const before = answersOf(a);
  for (const f of snap.fields) if (f.type === "file" && f.required && !files.has(f.id) && !before[f.id]) throw new RecordInputError(`Attach "${f.label}".`);

  const actor = await actorName(profileId);
  const stored = await storeAnswerFiles(profileId, id, snap.fields, files);
  const kept = Object.fromEntries(snap.fields.filter(f => f.type === "file" && before[f.id] && !stored.has(f.id)).map(f => [f.id, before[f.id]!]));
  const replaced = snap.fields.filter(f => stored.has(f.id) && before[f.id]).map(f => before[f.id]!);
  try {
    const done = await db.transaction(async tx => {
      const [locked] = await tx.select().from(demoApplicationsTable).where(eq(demoApplicationsTable.id, id)).for("update");
      if (!locked || locked.status !== "Changes requested") throw new RecordInputError("This application can no longer be changed.");
      await tx.update(demoApplicationsTable).set({ status: "Submitted", answers: { ...answers, ...kept, ...Object.fromEntries(stored) }, updatedAt: new Date() }).where(eq(demoApplicationsTable.id, id));
      await tx.insert(demoApplicationEventsTable).values({ applicationId: id, status: "Submitted", note: note ? `Resubmitted with changes: ${note}` : "Resubmitted with changes", actor });
      await tx.insert(demoAuditTable).values({ profileId, actor, action: `Application ${id} edited and resubmitted` });
      await notifyUser(profileId, `Application for "${a.title}" resubmitted`, `/applications/${id}`, tx);
      return true;
    });
    if (done) await dropFiles(replaced);
  } catch (err) {
    await dropFiles([...stored.values()]);
    throw err;
  }
  return (await applicationDetail(profileId, id))!;
}
