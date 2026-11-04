/**
 * Payment Gateway (Phase 10): the deposit and withdrawal methods administrators create, and the logos they show.
 * The rules themselves (what a method may contain, what a request must satisfy) are in paymentRules.ts.
 */
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db, demoAuditTable, demoPaymentMethodsTable, demoRequestsTable, type DemoPaymentMethod } from "@workspace/db";
import { DemoInputError } from "./demoWorkspace";
import { fetchRemoteImage, MAX_LOGO_BYTES, RemoteImageError } from "./remoteImage";
import { findFile, removeFile, storeUpload, UploadError } from "./uploads";
import { describeAmountRule, parseMethod, type MethodField, type MethodInput, type MethodKind, type MethodRules } from "./paymentRules";

/** Logos belong to the platform, not to a user. */
const LOGO_OWNER = "platform";

export const methodRules = (m: DemoPaymentMethod): MethodRules => ({
  kind: m.kind as MethodKind, amountMode: m.amountMode === "fixed" ? "fixed" : "range", minCents: m.minCents, maxCents: m.maxCents,
  fixedAmountsCents: (m.fixedAmountsCents as number[]) ?? [], fields: (m.fields as MethodField[]) ?? [], proofMode: (m.proofMode as MethodRules["proofMode"]) ?? "off",
});

/** The logo address for each side: admins read any file; applicants get it through their own route. */
export const methodLogoUrl = (m: { id: string; logoFileId: string | null }, scope: "admin" | "applicant") =>
  !m.logoFileId ? undefined : scope === "admin" ? `/api/admin/files/${m.logoFileId}` : `/api/applicant/payment-methods/${m.id}/logo?v=${m.logoFileId.slice(0, 8)}`;

const dollars = (c: number | null) => (c === null ? null : c / 100);

function methodOut(m: DemoPaymentMethod, scope: "admin" | "applicant", requestCount = 0) {
  const r = methodRules(m);
  const logoUrl = methodLogoUrl(m, scope);
  return {
    id: m.id, kind: r.kind, name: m.name, ...(logoUrl ? { logoUrl } : {}),
    amountMode: r.amountMode, minAmount: dollars(r.minCents), maxAmount: dollars(r.maxCents), fixedAmounts: r.fixedAmountsCents.map(c => c / 100),
    amountRule: describeAmountRule(r), fields: r.fields, proofMode: r.proofMode, instructions: m.instructions,
    ...(scope === "admin" ? { enabled: m.enabled, sortOrder: m.sortOrder, requestCount, createdBy: m.createdBy, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() } : {}),
  };
}

async function requestCounts(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db.select({ id: demoRequestsTable.methodId, n: count() }).from(demoRequestsTable)
    .where(inArray(demoRequestsTable.methodId, ids)).groupBy(demoRequestsTable.methodId);
  return new Map(rows.map(r => [r.id!, r.n]));
}

const ordered = [asc(demoPaymentMethodsTable.sortOrder), asc(demoPaymentMethodsTable.createdAt)];

export async function listAdminMethods(kind: MethodKind) {
  const rows = await db.select().from(demoPaymentMethodsTable).where(eq(demoPaymentMethodsTable.kind, kind)).orderBy(...ordered);
  const counts = await requestCounts(rows.map(r => r.id));
  return rows.map(m => methodOut(m, "admin", counts.get(m.id) ?? 0));
}

export async function adminMethod(id: string) {
  const m = await findMethod(id);
  if (!m) return undefined;
  return methodOut(m, "admin", (await requestCounts([m.id])).get(m.id) ?? 0);
}

/** What applicants can choose from: enabled methods only, without the admin's bookkeeping. */
export async function listApplicantMethods(kind: MethodKind) {
  const rows = await db.select().from(demoPaymentMethodsTable)
    .where(and(eq(demoPaymentMethodsTable.kind, kind), eq(demoPaymentMethodsTable.enabled, true))).orderBy(...ordered);
  return rows.map(m => methodOut(m, "applicant"));
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function findMethod(id: string) {
  if (!isUuid(id)) return undefined;
  const [m] = await db.select().from(demoPaymentMethodsTable).where(eq(demoPaymentMethodsTable.id, id));
  return m;
}

/** The stored method back in the shape an admin sends, so a partial update can be merged and checked as a whole. */
const asInput = (m: DemoPaymentMethod): MethodInput => {
  const r = methodRules(m);
  return {
    name: m.name, amountMode: r.amountMode, minAmount: dollars(r.minCents), maxAmount: dollars(r.maxCents), fixedAmounts: r.fixedAmountsCents.map(c => c / 100),
    fields: r.fields, proofMode: r.proofMode, instructions: m.instructions, enabled: m.enabled,
  };
};

const audit = (actor: string, action: string, tx: Pick<typeof db, "insert"> = db) => tx.insert(demoAuditTable).values({ actor, action });

async function nameTaken(kind: MethodKind, name: string, exceptId?: string) {
  const rows = await db.select({ id: demoPaymentMethodsTable.id, name: demoPaymentMethodsTable.name }).from(demoPaymentMethodsTable).where(eq(demoPaymentMethodsTable.kind, kind));
  return rows.some(r => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase());
}

export async function createMethod(kind: MethodKind, input: MethodInput, actor: string) {
  const parsed = parseMethod(input, kind);
  if (typeof parsed === "string") throw new DemoInputError(parsed);
  if (await nameTaken(kind, parsed.name)) throw new DemoInputError(`There's already a ${kind.toLowerCase()} method called "${parsed.name}".`);
  const [{ n }] = await db.select({ n: count() }).from(demoPaymentMethodsTable).where(eq(demoPaymentMethodsTable.kind, kind));
  if (n >= 50) throw new DemoInputError("You can have at most 50 methods of each kind. Delete or reuse one.");
  const m = await db.transaction(async tx => {
    const [row] = await tx.insert(demoPaymentMethodsTable).values({
      kind, name: parsed.name, amountMode: parsed.amountMode, minCents: parsed.minCents, maxCents: parsed.maxCents,
      fixedAmountsCents: parsed.fixedAmountsCents, fields: parsed.fields, proofMode: parsed.proofMode, instructions: parsed.instructions,
      enabled: parsed.enabled, sortOrder: n, createdBy: actor,
    }).returning();
    await audit(actor, `${kind} method "${parsed.name}" created (${describeAmountRule(parsed)}, ${parsed.fields.length} field${parsed.fields.length === 1 ? "" : "s"}${kind === "Deposit" ? `, proof ${parsed.proofMode}` : ""}${parsed.enabled ? "" : ", disabled"})`, tx);
    return row!;
  });
  return methodOut(m, "admin");
}

/** Change a method; only the parts sent change. Requests already placed keep their own copy of the method. */
export async function updateMethod(id: string, input: MethodInput & { sortOrder?: unknown }, actor: string) {
  const current = await findMethod(id);
  if (!current) return undefined;
  const kind = current.kind as MethodKind;
  const merged: MethodInput = { ...asInput(current) };
  for (const k of Object.keys(merged) as (keyof MethodInput)[]) if (input[k] !== undefined) merged[k] = input[k];
  // Switching to a range, or to fixed amounts, drops the other mode's numbers unless they were sent too.
  if (input.amountMode === "range" && input.fixedAmounts === undefined) merged.fixedAmounts = [];
  if (input.amountMode === "fixed" && input.minAmount === undefined && input.maxAmount === undefined) { merged.minAmount = null; merged.maxAmount = null; }
  const parsed = parseMethod(merged, kind);
  if (typeof parsed === "string") throw new DemoInputError(parsed);
  if (parsed.name.toLowerCase() !== current.name.toLowerCase() && await nameTaken(kind, parsed.name, id)) {
    throw new DemoInputError(`There's already a ${kind.toLowerCase()} method called "${parsed.name}".`);
  }
  const sortOrder = typeof input.sortOrder === "number" && Number.isInteger(input.sortOrder) && input.sortOrder >= 0 && input.sortOrder < 1000 ? input.sortOrder : current.sortOrder;

  const changes: string[] = [];
  if (parsed.name !== current.name) changes.push(`renamed to "${parsed.name}"`);
  const before = methodRules(current);
  if (describeAmountRule(parsed) !== describeAmountRule(before)) changes.push(`amount ${describeAmountRule(parsed)}`);
  if (JSON.stringify(parsed.fields) !== JSON.stringify(before.fields)) changes.push(`fields (${parsed.fields.length})`);
  if (parsed.proofMode !== before.proofMode) changes.push(`proof ${parsed.proofMode}`);
  if (parsed.instructions !== current.instructions) changes.push("instructions");
  if (parsed.enabled !== current.enabled) changes.push(parsed.enabled ? "enabled" : "disabled");
  if (sortOrder !== current.sortOrder) changes.push("order");
  if (!changes.length) return adminMethod(id);

  await db.transaction(async tx => {
    await tx.update(demoPaymentMethodsTable).set({
      name: parsed.name, amountMode: parsed.amountMode, minCents: parsed.minCents, maxCents: parsed.maxCents, fixedAmountsCents: parsed.fixedAmountsCents,
      fields: parsed.fields, proofMode: parsed.proofMode, instructions: parsed.instructions, enabled: parsed.enabled, sortOrder, updatedAt: new Date(),
    }).where(eq(demoPaymentMethodsTable.id, id));
    await audit(actor, `${kind} method "${current.name}" changed: ${changes.join(", ")}`, tx);
  });
  return adminMethod(id);
}

/** Move a method one place up or down in its list (what applicants see first). */
export async function moveMethod(id: string, direction: "up" | "down", actor: string) {
  const current = await findMethod(id);
  if (!current) return undefined;
  const rows = await db.select().from(demoPaymentMethodsTable).where(eq(demoPaymentMethodsTable.kind, current.kind)).orderBy(...ordered);
  const i = rows.findIndex(r => r.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= rows.length) return listAdminMethods(current.kind as MethodKind);
  [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  await db.transaction(async tx => {
    for (const [order, r] of rows.entries()) await tx.update(demoPaymentMethodsTable).set({ sortOrder: order }).where(eq(demoPaymentMethodsTable.id, r.id));
    await audit(actor, `${current.kind} method "${current.name}" moved ${direction}`, tx);
  });
  return listAdminMethods(current.kind as MethodKind);
}

/** Delete a method that was never used. A used method is only disabled, so its requests keep their history. */
export async function deleteMethod(id: string, actor: string) {
  const current = await findMethod(id);
  if (!current) return false;
  const used = (await requestCounts([id])).get(id) ?? 0;
  if (used) throw new DemoInputError(`"${current.name}" has ${used} request${used === 1 ? "" : "s"}, so it can't be deleted. Disable it instead: applicants won't see it any more.`);
  await db.transaction(async tx => {
    await tx.delete(demoPaymentMethodsTable).where(eq(demoPaymentMethodsTable.id, id));
    await audit(actor, `${current.kind} method "${current.name}" deleted`, tx);
  });
  if (current.logoFileId) await removeFile(current.logoFileId);
  return true;
}

class MethodMissing extends Error {}

async function storeLogo(id: string, file: Express.Multer.File, actor: string, how: string) {
  let previous: string | null = null; let name = "";
  try {
    previous = await storeUpload(LOGO_OWNER, "logo", file, async (stored, tx) => {
      const [m] = await tx.select().from(demoPaymentMethodsTable).where(eq(demoPaymentMethodsTable.id, id)).for("update");
      if (!m) throw new MethodMissing();
      name = m.name;
      await tx.update(demoPaymentMethodsTable).set({ logoFileId: stored.id, updatedAt: new Date() }).where(eq(demoPaymentMethodsTable.id, id));
      await audit(actor, `${m.kind} method "${m.name}" logo ${how}`, tx);
      return m.logoFileId;
    });
  } catch (err) {
    if (err instanceof MethodMissing) return false;
    throw err;
  }
  if (previous) await removeFile(previous);
  return Boolean(name);
}

/** Replace a method's logo with an uploaded image (PNG, JPEG or WebP, up to 2 MB; re-encoded to WebP). */
export async function setMethodLogo(id: string, file: Express.Multer.File | undefined, actor: string) {
  if (!isUuid(id)) return false;
  if (file && file.size > MAX_LOGO_BYTES) throw new UploadError("Logos must be 2 MB or smaller.");
  if (!file) throw new UploadError("Choose a logo image to upload.");
  return storeLogo(id, file, actor, "uploaded");
}

/** Download the image at `url` once and store it as the method's logo (never hot-linked). */
export async function setMethodLogoFromUrl(id: string, url: string, actor: string) {
  if (!await findMethod(id)) return false;
  let image: { buffer: Buffer; name: string };
  try { image = await fetchRemoteImage(url); } catch (err) {
    if (err instanceof RemoteImageError) throw new DemoInputError(err.message);
    throw err;
  }
  const file = { buffer: image.buffer, size: image.buffer.length, originalname: image.name } as Express.Multer.File;
  return storeLogo(id, file, actor, `taken from ${new URL(url).hostname}`);
}

export async function clearMethodLogo(id: string, actor: string) {
  const current = await findMethod(id);
  if (!current) return false;
  if (!current.logoFileId) return true;
  await db.transaction(async tx => {
    await tx.update(demoPaymentMethodsTable).set({ logoFileId: null, updatedAt: new Date() }).where(eq(demoPaymentMethodsTable.id, id));
    await audit(actor, `${current.kind} method "${current.name}" logo removed`, tx);
  });
  await removeFile(current.logoFileId);
  return true;
}

/** The stored logo file for the applicant's route (any method: old requests show the logo of a method disabled since). */
export async function methodLogoFile(id: string) {
  const m = await findMethod(id);
  return m?.logoFileId ? findFile(m.logoFileId, LOGO_OWNER) : undefined;
}
