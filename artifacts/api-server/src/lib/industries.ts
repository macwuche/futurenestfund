/**
 * Industries (Phase 11): an administrator-managed list. Every user picks one (at sign-up, or later when asked);
 * every grant plan belongs to one, or to all industries. The user's industry decides which plans are recommended.
 */
import { asc, count, eq, inArray, sql } from "drizzle-orm";
import { db, demoAuditTable, demoGrantPlansTable, demoIndustriesTable, demoProfilesTable } from "@workspace/db";
import { DemoInputError } from "./demoWorkspace";
import { notifyUser } from "./notifications";

export const INDUSTRY_NAME = [2, 60] as const;
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "");

/** "Women empowerment", or why it can't be an industry name. */
export function parseIndustryName(v: unknown): string | { error: string } {
  const name = clean(v);
  if (name.length < INDUSTRY_NAME[0] || name.length > INDUSTRY_NAME[1]) return { error: `Give the industry a name of ${INDUSTRY_NAME[0]}–${INDUSTRY_NAME[1]} characters.` };
  return name;
}

const byName = asc(sql`lower(${demoIndustriesTable.name})`);

/** The list everyone sees (sign-up form, Settings, plan filters), A to Z. */
export async function listIndustries() {
  const rows = await db.select({ id: demoIndustriesTable.id, name: demoIndustriesTable.name }).from(demoIndustriesTable).orderBy(byName);
  return rows;
}

export async function findIndustry(id: unknown) {
  if (!isUuid(id)) return undefined;
  const [row] = await db.select().from(demoIndustriesTable).where(eq(demoIndustriesTable.id, id));
  return row;
}

/** Industry names by id, for lists that show them. */
export async function industryNames(ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter(isUuid))];
  if (!wanted.length) return new Map<string, string>();
  const rows = await db.select({ id: demoIndustriesTable.id, name: demoIndustriesTable.name }).from(demoIndustriesTable).where(inArray(demoIndustriesTable.id, wanted));
  return new Map(rows.map(r => [r.id, r.name]));
}

/** The admin's view: each industry with how many plans and users use it. */
export async function listAdminIndustries() {
  const rows = await listIndustries();
  const plans = await db.select({ id: demoGrantPlansTable.industryId, n: count() }).from(demoGrantPlansTable).groupBy(demoGrantPlansTable.industryId);
  const users = await db.select({ id: demoProfilesTable.industryId, n: count() }).from(demoProfilesTable).groupBy(demoProfilesTable.industryId);
  const planCount = new Map(plans.map(r => [r.id, r.n])); const userCount = new Map(users.map(r => [r.id, r.n]));
  return rows.map(r => ({ ...r, planCount: planCount.get(r.id) ?? 0, userCount: userCount.get(r.id) ?? 0 }));
}

/** The existing name that clashes with `name` (case doesn't matter), if any. */
async function nameTaken(name: string, exceptId?: string) {
  const [row] = await db.select({ id: demoIndustriesTable.id, name: demoIndustriesTable.name }).from(demoIndustriesTable)
    .where(sql`lower(${demoIndustriesTable.name}) = ${name.toLowerCase()}`);
  return row && row.id !== exceptId ? row.name : null;
}

const MAX_INDUSTRIES = 200;

export async function createIndustry(input: unknown, actor: string) {
  const name = parseIndustryName(input);
  if (typeof name !== "string") throw new DemoInputError(name.error);
  const clash = await nameTaken(name);
  if (clash) throw new DemoInputError(`"${clash}" is already on the list.`);
  const [{ n }] = await db.select({ n: count() }).from(demoIndustriesTable);
  if (n >= MAX_INDUSTRIES) throw new DemoInputError(`The list can hold at most ${MAX_INDUSTRIES} industries.`);
  await db.transaction(async tx => {
    await tx.insert(demoIndustriesTable).values({ name });
    await tx.insert(demoAuditTable).values({ actor, action: `Industry "${name}" added` });
  });
  return listAdminIndustries();
}

export async function renameIndustry(id: string, input: unknown, actor: string) {
  const current = await findIndustry(id);
  if (!current) return undefined;
  const name = parseIndustryName(input);
  if (typeof name !== "string") throw new DemoInputError(name.error);
  if (name === current.name) return listAdminIndustries();
  const clash = name.toLowerCase() !== current.name.toLowerCase() ? await nameTaken(name, id) : null;
  if (clash) throw new DemoInputError(`"${clash}" is already on the list.`);
  await db.transaction(async tx => {
    await tx.update(demoIndustriesTable).set({ name }).where(eq(demoIndustriesTable.id, id));
    await tx.insert(demoAuditTable).values({ actor, action: `Industry "${current.name}" renamed to "${name}"` });
  });
  return listAdminIndustries();
}

/**
 * Remove an industry no plan uses. Users who had it are asked to choose again (their industry is cleared, and they're told).
 */
export async function deleteIndustry(id: string, actor: string) {
  const current = await findIndustry(id);
  if (!current) return undefined;
  const [{ n }] = await db.select({ n: count() }).from(demoGrantPlansTable).where(eq(demoGrantPlansTable.industryId, id));
  if (n) throw new DemoInputError(`${n} grant plan${n === 1 ? " uses" : "s use"} "${current.name}". Move ${n === 1 ? "it" : "them"} to another industry first.`);
  await db.transaction(async tx => {
    const users = await tx.update(demoProfilesTable).set({ industryId: null }).where(eq(demoProfilesTable.industryId, id)).returning({ id: demoProfilesTable.id });
    await tx.delete(demoIndustriesTable).where(eq(demoIndustriesTable.id, id));
    await tx.insert(demoAuditTable).values({ actor, action: `Industry "${current.name}" removed${users.length ? ` (${users.length} user${users.length === 1 ? "" : "s"} asked to choose again)` : ""}` });
    for (const u of users) await notifyUser(u.id, `"${current.name}" is no longer on our list of industries. Choose your industry again so we can recommend the right grants.`, "/settings", tx);
  });
  return listAdminIndustries();
}

/** The user's own choice (Settings or the dashboard prompt); an administrator can set it too. Audited. */
export async function setUserIndustry(profileId: string, industryId: unknown, actor: string) {
  const industry = await findIndustry(industryId);
  if (!industry) throw new DemoInputError("Choose an industry from the list.");
  const [p] = await db.select({ industryId: demoProfilesTable.industryId }).from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId));
  if (!p) return false;
  if (p.industryId === industry.id) return true;
  await db.transaction(async tx => {
    await tx.update(demoProfilesTable).set({ industryId: industry.id }).where(eq(demoProfilesTable.id, profileId));
    await tx.insert(demoAuditTable).values({ profileId, actor, action: `Industry set to "${industry.name}"` });
  });
  return true;
}

/** At sign-up the industry comes in the account's metadata; anything unknown is ignored (the user is asked later). */
export async function industryFromSignUp(v: unknown) {
  return (await findIndustry(v))?.id ?? null;
}
