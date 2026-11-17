/**
 * Pure rules for grant plans (Phase 11): what an administrator may save as a plan, and the initials shown when a plan
 * has no logo. No database access here, so it's unit-tested directly.
 */
import { feeCents, parseFee, type FeeRule } from "./fees";
import { parseFields, PLAN_FIELD_TYPES, type MethodField } from "./paymentRules";

export const PLAN_LIMITS = { name: [2, 80], description: 2000, fields: 30, fileFields: 10 } as const;
const MIN_AMOUNT_CENTS = 100; // $1
const MAX_AMOUNT_CENTS = 1_000_000_000; // $10,000,000

export type AmountMode = "fixed" | "range";
export type PlanInput = { name?: unknown; description?: unknown; industryId?: unknown; amountMode?: unknown; amount?: unknown; maxAmount?: unknown; fee?: unknown; fields?: unknown; enabled?: unknown };
/** `amountCents` is the award (fixed) or the smallest amount an applicant may ask for (range, up to `maxAmountCents`). */
export type ParsedPlan = { name: string; description: string; industryId: string | null; amountMode: AmountMode; amountCents: number; maxAmountCents: number | null; fee: FeeRule; fields: MethodField[]; enabled: boolean };
/** The award rule of a plan, or of an application's copy of it (copies from before ranges have no mode: fixed). */
export type AwardRule = { amountMode?: AmountMode; amountCents: number; maxAmountCents?: number | null };

const clean = (v: unknown, multiline = false) =>
  typeof v === "string" ? (multiline ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "") : v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ")).trim() : "";
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Dollars to cents for an award: $1 to $10,000,000 with at most two decimals; null when it isn't one. */
export function awardCents(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const c = Math.round(v * 100);
  if (!Number.isSafeInteger(c) || c < MIN_AMOUNT_CENTS || c > MAX_AMOUNT_CENTS || Math.abs(v * 100 - c) > 0.00001) return null;
  return c;
}

/**
 * Check a plan an administrator wants to save and normalise it, or say what's wrong.
 * `industryId` must be a known industry or null (all industries): that check needs the database, so it's left to the caller.
 */
export function parsePlan(input: PlanInput): ParsedPlan | string {
  const name = clean(input.name);
  if (name.length < PLAN_LIMITS.name[0] || name.length > PLAN_LIMITS.name[1]) return `Give the plan a name of ${PLAN_LIMITS.name[0]}–${PLAN_LIMITS.name[1]} characters.`;
  const description = clean(input.description, true);
  if (description.length > PLAN_LIMITS.description) return `Keep the description under ${PLAN_LIMITS.description.toLocaleString("en-US")} characters.`;
  const industryId = input.industryId === null || input.industryId === undefined || input.industryId === "" ? null : input.industryId;
  if (industryId !== null && !isUuid(industryId)) return "Choose an industry, or All industries.";
  const mode = input.amountMode ?? "fixed";
  if (mode !== "fixed" && mode !== "range") return "Choose a fixed award or a range.";
  const range = mode === "range";
  const amountCents = awardCents(input.amount);
  if (amountCents === null) return range ? "The minimum must be between $1 and $10,000,000, with at most two decimals." : "The award amount must be between $1 and $10,000,000, with at most two decimals.";
  let maxAmountCents: number | null = null;
  if (range) {
    maxAmountCents = awardCents(input.maxAmount);
    if (maxAmountCents === null) return "The maximum must be between $1 and $10,000,000, with at most two decimals.";
    if (maxAmountCents <= amountCents) return "The maximum must be more than the minimum.";
  }
  const fee = parseFee(input.fee, "The application charge");
  if (typeof fee === "string") return fee;
  // A percentage is never more than 100%, so checking the smallest award is enough.
  if (feeCents(fee, amountCents) > amountCents) return range ? "The application charge can't be more than the minimum." : "The application charge can't be more than the award.";
  const fields = parseFields(input.fields, PLAN_FIELD_TYPES, PLAN_LIMITS.fields, "A plan's form");
  if (typeof fields === "string") return fields;
  if (fields.filter(f => f.type === "file").length > PLAN_LIMITS.fileFields) return `A plan's form can ask for at most ${PLAN_LIMITS.fileFields} files.`;
  return { name, description, industryId, amountMode: mode, amountCents, maxAmountCents, fee, fields, enabled: input.enabled !== false };
}

export const isRange = (r: AwardRule) => r.amountMode === "range" && typeof r.maxAmountCents === "number";

/** "$1,000" or "$1,000.50", for messages. */
const usdShort = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * The amount an applicant asks for, in cents, or what's wrong with it. A fixed plan needs no answer (anything sent is
 * ignored: the award is the plan's); a range plan needs an amount inside its range with at most two decimals.
 * `raw` comes from a form, so "4000", "4,000.50" and "$4000" are read too.
 */
export function requestedCents(rule: AwardRule, raw: unknown): number | string {
  if (!isRange(rule)) return rule.amountCents;
  const text = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : typeof raw === "string" ? raw.replace(/[$,\s]/g, "") : "";
  const range = `between ${usdShort(rule.amountCents)} and ${usdShort(rule.maxAmountCents!)}`;
  if (!text) return `Enter the amount you're requesting, ${range}.`;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return `Enter the amount you're requesting as a number with at most two decimals, ${range}.`;
  const cents = Math.round(Number(text) * 100);
  if (cents < rule.amountCents || cents > rule.maxAmountCents!) return `The amount you request must be ${range}.`;
  return cents;
}

/** "$5,000.00" or "$1,000.00 – $10,000.00", for the audit log. */
export const awardText = (r: AwardRule, usd: (c: number) => string) => isRange(r) ? `${usd(r.amountCents)} – ${usd(r.maxAmountCents!)}` : usd(r.amountCents);

/** The placeholder shown when a plan has no logo: "School Grant" → "SG", "Healthcare" → "HE". */
export function planInitials(name: string): string {
  const words = name.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "GP";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
