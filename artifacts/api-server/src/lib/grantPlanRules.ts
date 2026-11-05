/**
 * Pure rules for grant plans (Phase 11): what an administrator may save as a plan, and the initials shown when a plan
 * has no logo. No database access here, so it's unit-tested directly.
 */
import { feeCents, parseFee, type FeeRule } from "./fees";
import { parseFields, PLAN_FIELD_TYPES, type MethodField } from "./paymentRules";

export const PLAN_LIMITS = { name: [2, 80], description: 2000, fields: 30, fileFields: 10 } as const;
const MIN_AMOUNT_CENTS = 100; // $1
const MAX_AMOUNT_CENTS = 1_000_000_000; // $10,000,000

export type PlanInput = { name?: unknown; description?: unknown; industryId?: unknown; amount?: unknown; fee?: unknown; fields?: unknown; enabled?: unknown };
export type ParsedPlan = { name: string; description: string; industryId: string | null; amountCents: number; fee: FeeRule; fields: MethodField[]; enabled: boolean };

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
  const amountCents = awardCents(input.amount);
  if (amountCents === null) return "The award amount must be between $1 and $10,000,000, with at most two decimals.";
  const fee = parseFee(input.fee, "The application fee");
  if (typeof fee === "string") return fee;
  if (feeCents(fee, amountCents) > amountCents) return "The application fee can't be more than the award.";
  const fields = parseFields(input.fields, PLAN_FIELD_TYPES, PLAN_LIMITS.fields, "A plan's form");
  if (typeof fields === "string") return fields;
  if (fields.filter(f => f.type === "file").length > PLAN_LIMITS.fileFields) return `A plan's form can ask for at most ${PLAN_LIMITS.fileFields} files.`;
  return { name, description, industryId, amountCents, fee, fields, enabled: input.enabled !== false };
}

/** The placeholder shown when a plan has no logo: "School Grant" → "SG", "Healthcare" → "HE". */
export function planInitials(name: string): string {
  const words = name.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "GP";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
