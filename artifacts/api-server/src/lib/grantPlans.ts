/**
 * Grant plans (Phase 11): administrators create them; applicants see the enabled ones, recommended by industry, and
 * apply through each plan's own form (applications: lib/planApplications.ts). The rules are in grantPlanRules.ts.
 */
import { count, desc, eq, inArray } from "drizzle-orm";
import { db, demoApplicationsTable, demoAuditTable, demoGrantPlansTable, demoProfilesTable, type DemoGrantPlan } from "@workspace/db";
import { DemoInputError } from "./demoWorkspace";
import { fetchRemoteImage, MAX_LOGO_BYTES, RemoteImageError } from "./remoteImage";
import { findFile, removeFile, storeUpload, UploadError } from "./uploads";
import { describeFee, feeCents, feeOut, storedFee, type FeeRule } from "./fees";
import { usd, type MethodField } from "./paymentRules";
import { parsePlan, planInitials, type PlanInput } from "./grantPlanRules";
import { findIndustry, industryNames } from "./industries";

/** Logos belong to the platform, not to a user. */
const LOGO_OWNER = "platform";
export const ALL_INDUSTRIES = "All industries";

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const planFee = (p: Pick<DemoGrantPlan, "feeMode" | "feeValue">): FeeRule => storedFee(p.feeMode, p.feeValue);
export const planFields = (p: Pick<DemoGrantPlan, "fields">) => (p.fields as MethodField[]) ?? [];

export const planLogoUrl = (p: { id: string; logoFileId: string | null }, scope: "admin" | "applicant") =>
  !p.logoFileId ? undefined : scope === "admin" ? `/api/admin/files/${p.logoFileId}` : `/api/applicant/grant-plans/${p.id}/logo?v=${p.logoFileId.slice(0, 8)}`;

type Extras = { industryName?: string | null; applicationCount?: number; recommended?: boolean };

function planOut(p: DemoGrantPlan, scope: "admin" | "applicant", x: Extras = {}) {
  const fee = planFee(p);
  const logoUrl = planLogoUrl(p, scope);
  return {
    id: p.id, name: p.name, description: p.description, industryId: p.industryId ?? null,
    industry: p.industryId ? x.industryName ?? "Unknown industry" : ALL_INDUSTRIES,
    amount: p.amountCents / 100, fee: feeOut(fee), feeAmount: feeCents(fee, p.amountCents) / 100, feeText: describeFee(fee, p.amountCents),
    ...(logoUrl ? { logoUrl } : {}), initials: planInitials(p.name), fields: planFields(p),
    ...(scope === "admin"
      ? { enabled: p.enabled, applicationCount: x.applicationCount ?? 0, createdBy: p.createdBy, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() }
      : { recommended: x.recommended ?? false }),
  };
}

async function applicationCounts(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db.select({ id: demoApplicationsTable.planId, n: count() }).from(demoApplicationsTable)
    .where(inArray(demoApplicationsTable.planId, ids)).groupBy(demoApplicationsTable.planId);
  return new Map(rows.map(r => [r.id!, r.n]));
}

export async function findPlan(id: string) {
  if (!isUuid(id)) return undefined;
  const [p] = await db.select().from(demoGrantPlansTable).where(eq(demoGrantPlansTable.id, id));
  return p;
}

export async function listAdminPlans() {
  const rows = await db.select().from(demoGrantPlansTable).orderBy(desc(demoGrantPlansTable.createdAt));
  const [counts, names] = await Promise.all([applicationCounts(rows.map(r => r.id)), industryNames(rows.map(r => r.industryId))]);
  return rows.map(p => planOut(p, "admin", { applicationCount: counts.get(p.id) ?? 0, industryName: p.industryId ? names.get(p.industryId) : null }));
}

export async function adminPlan(id: string) {
  const p = await findPlan(id);
  if (!p) return undefined;
  const [counts, names] = await Promise.all([applicationCounts([p.id]), industryNames([p.industryId])]);
  return planOut(p, "admin", { applicationCount: counts.get(p.id) ?? 0, industryName: p.industryId ? names.get(p.industryId) : null });
}

/** The applicant's industry, for recommendations. */
async function industryOf(profileId: string) {
  const [row] = await db.select({ industryId: demoProfilesTable.industryId }).from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId));
  return row?.industryId ?? null;
}

/** A plan is recommended when it's for the applicant's industry, or for all industries. */
const isRecommended = (p: DemoGrantPlan, industryId: string | null) => p.industryId === null || (industryId !== null && p.industryId === industryId);

/** What applicants see: enabled plans, the recommended ones first, newest first within each group. */
export async function listApplicantPlans(profileId: string) {
  const [rows, mine] = await Promise.all([
    db.select().from(demoGrantPlansTable).where(eq(demoGrantPlansTable.enabled, true)).orderBy(desc(demoGrantPlansTable.createdAt)),
    industryOf(profileId),
  ]);
  const names = await industryNames(rows.map(r => r.industryId));
  const out = rows.map(p => ({ rec: isRecommended(p, mine), plan: planOut(p, "applicant", { recommended: isRecommended(p, mine), industryName: p.industryId ? names.get(p.industryId) : null }) }));
  return [...out.filter(x => x.rec), ...out.filter(x => !x.rec)].map(x => x.plan);
}

/** One enabled plan for the applicant (a switched-off plan can't be opened or applied to). */
export async function applicantPlan(profileId: string, id: string) {
  const p = await findPlan(id);
  if (!p || !p.enabled) return undefined;
  const [names, mine] = await Promise.all([industryNames([p.industryId]), industryOf(profileId)]);
  return planOut(p, "applicant", { recommended: isRecommended(p, mine), industryName: p.industryId ? names.get(p.industryId) : null });
}

const audit = (actor: string, action: string, tx: Pick<typeof db, "insert"> = db) => tx.insert(demoAuditTable).values({ actor, action });

async function checkedPlan(input: PlanInput) {
  const parsed = parsePlan(input);
  if (typeof parsed === "string") throw new DemoInputError(parsed);
  if (parsed.industryId && !await findIndustry(parsed.industryId)) throw new DemoInputError("That industry is no longer on the list. Choose another, or All industries.");
  return parsed;
}

const MAX_PLANS = 200;
const fieldCount = (n: number) => `${n} field${n === 1 ? "" : "s"}`;

export async function createPlan(input: PlanInput, actor: string) {
  const parsed = await checkedPlan(input);
  const [{ n }] = await db.select({ n: count() }).from(demoGrantPlansTable);
  if (n >= MAX_PLANS) throw new DemoInputError(`You can have at most ${MAX_PLANS} grant plans. Delete or reuse one.`);
  const p = await db.transaction(async tx => {
    const [row] = await tx.insert(demoGrantPlansTable).values({
      name: parsed.name, description: parsed.description, industryId: parsed.industryId, amountCents: parsed.amountCents,
      feeMode: parsed.fee.mode, feeValue: parsed.fee.value, fields: parsed.fields, enabled: parsed.enabled, createdBy: actor,
    }).returning();
    await audit(actor, `Grant plan "${parsed.name}" created (${usd(parsed.amountCents)}, application ${describeFee(parsed.fee, parsed.amountCents).toLowerCase()}, ${fieldCount(parsed.fields.length)}${parsed.enabled ? "" : ", off"})`, tx);
    return row!;
  });
  return adminPlan(p.id);
}

const asInput = (p: DemoGrantPlan): PlanInput => ({
  name: p.name, description: p.description, industryId: p.industryId, amount: p.amountCents / 100, fee: feeOut(planFee(p)), fields: planFields(p), enabled: p.enabled,
});

/** Change a plan; only the parts sent change. Applications already submitted keep their own copy of the plan. */
export async function updatePlan(id: string, input: PlanInput, actor: string) {
  const current = await findPlan(id);
  if (!current) return undefined;
  const merged: PlanInput = { ...asInput(current) };
  for (const k of Object.keys(merged) as (keyof PlanInput)[]) if (input[k] !== undefined) merged[k] = input[k];
  const parsed = await checkedPlan(merged);
  const changes: string[] = [];
  if (parsed.name !== current.name) changes.push(`renamed to "${parsed.name}"`);
  if (parsed.description !== current.description) changes.push("description");
  if (parsed.industryId !== current.industryId) {
    const name = parsed.industryId ? (await findIndustry(parsed.industryId))?.name : ALL_INDUSTRIES;
    changes.push(`industry ${name}`);
  }
  if (parsed.amountCents !== current.amountCents) changes.push(`award ${usd(parsed.amountCents)}`);
  const before = planFee(current);
  if (parsed.fee.mode !== before.mode || parsed.fee.value !== before.value) changes.push(`application ${describeFee(parsed.fee, parsed.amountCents).toLowerCase()}`);
  if (JSON.stringify(parsed.fields) !== JSON.stringify(planFields(current))) changes.push(`form (${fieldCount(parsed.fields.length)})`);
  if (parsed.enabled !== current.enabled) changes.push(parsed.enabled ? "switched on" : "switched off");
  if (!changes.length) return adminPlan(id);
  await db.transaction(async tx => {
    await tx.update(demoGrantPlansTable).set({
      name: parsed.name, description: parsed.description, industryId: parsed.industryId, amountCents: parsed.amountCents,
      feeMode: parsed.fee.mode, feeValue: parsed.fee.value, fields: parsed.fields, enabled: parsed.enabled, updatedAt: new Date(),
    }).where(eq(demoGrantPlansTable.id, id));
    await audit(actor, `Grant plan "${current.name}" changed: ${changes.join(", ")}`, tx);
  });
  return adminPlan(id);
}

/** Delete a plan nobody applied to. A plan with applications is only switched off, so they keep their history. */
export async function deletePlan(id: string, actor: string) {
  const current = await findPlan(id);
  if (!current) return false;
  const used = (await applicationCounts([id])).get(id) ?? 0;
  if (used) throw new DemoInputError(`"${current.name}" has ${used} application${used === 1 ? "" : "s"}, so it can't be deleted. Switch it off instead: applicants won't see it any more.`);
  await db.transaction(async tx => {
    await tx.delete(demoGrantPlansTable).where(eq(demoGrantPlansTable.id, id));
    await audit(actor, `Grant plan "${current.name}" deleted`, tx);
  });
  if (current.logoFileId) await removeFile(current.logoFileId);
  return true;
}

class PlanMissing extends Error {}

async function storeLogo(id: string, file: Express.Multer.File, actor: string, how: string) {
  let previous: string | null = null; let found = false;
  try {
    previous = await storeUpload(LOGO_OWNER, "logo", file, async (stored, tx) => {
      const [p] = await tx.select().from(demoGrantPlansTable).where(eq(demoGrantPlansTable.id, id)).for("update");
      if (!p) throw new PlanMissing();
      found = true;
      await tx.update(demoGrantPlansTable).set({ logoFileId: stored.id, updatedAt: new Date() }).where(eq(demoGrantPlansTable.id, id));
      await audit(actor, `Grant plan "${p.name}" logo ${how}`, tx);
      return p.logoFileId;
    });
  } catch (err) {
    if (err instanceof PlanMissing) return false;
    throw err;
  }
  if (previous) await removeFile(previous);
  return found;
}

/** Replace a plan's logo with an uploaded image (PNG, JPEG or WebP, up to 2 MB; re-encoded to WebP). */
export async function setPlanLogo(id: string, file: Express.Multer.File | undefined, actor: string) {
  if (!isUuid(id)) return false;
  if (file && file.size > MAX_LOGO_BYTES) throw new UploadError("Logos must be 2 MB or smaller.");
  if (!file) throw new UploadError("Choose a logo image to upload.");
  return storeLogo(id, file, actor, "uploaded");
}

/** Download the image at `url` once and store it as the plan's logo (never hot-linked). */
export async function setPlanLogoFromUrl(id: string, url: string, actor: string) {
  if (!await findPlan(id)) return false;
  let image: { buffer: Buffer; name: string };
  try { image = await fetchRemoteImage(url); } catch (err) {
    if (err instanceof RemoteImageError) throw new DemoInputError(err.message);
    throw err;
  }
  const file = { buffer: image.buffer, size: image.buffer.length, originalname: image.name } as Express.Multer.File;
  return storeLogo(id, file, actor, `taken from ${new URL(url).hostname}`);
}

export async function clearPlanLogo(id: string, actor: string) {
  const current = await findPlan(id);
  if (!current) return false;
  if (!current.logoFileId) return true;
  await db.transaction(async tx => {
    await tx.update(demoGrantPlansTable).set({ logoFileId: null, updatedAt: new Date() }).where(eq(demoGrantPlansTable.id, id));
    await audit(actor, `Grant plan "${current.name}" logo removed`, tx);
  });
  await removeFile(current.logoFileId);
  return true;
}

/** The stored logo for the applicant's route (any plan: applications show the logo of a plan switched off since). */
export async function planLogoFile(id: string) {
  const p = await findPlan(id);
  return p?.logoFileId ? findFile(p.logoFileId, LOGO_OWNER) : undefined;
}

