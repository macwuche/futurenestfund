/**
 * The applicant's eligible amount ("Largest open award at Tier N" on the dashboard).
 * An administrator sets one amount per tier in Settings → Money, and can give a user a custom amount that replaces it.
 * Shown only for now: it doesn't limit what an applicant can request.
 */

type Tier = 1 | 2 | 3;
export type TierAmountsCents = { tier1: number | null; tier2: number | null; tier3: number | null };
type SettingsSource = { tier1EligibleCents: number | null; tier2EligibleCents: number | null; tier3EligibleCents: number | null } | undefined;
type ProfileSource = { tier: number; eligibleCustom: boolean; eligibleCents: number | null };

const MAX_CENTS = 1_000_000_000; // $10,000,000
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const tierAmountsFrom = (s: SettingsSource): TierAmountsCents =>
  ({ tier1: s?.tier1EligibleCents ?? null, tier2: s?.tier2EligibleCents ?? null, tier3: s?.tier3EligibleCents ?? null });

/** The amount for a tier; tiers outside 1–3 are treated as the nearest one. */
export function tierAmount(amounts: TierAmountsCents, tier: number): number | null {
  const t = Math.min(3, Math.max(1, Math.round(tier))) as Tier;
  return amounts[`tier${t}`];
}

/** A user's custom amount replaces their tier's amount (a custom amount left empty means "not set" for that user). */
export function effectiveEligible(profile: ProfileSource, settings: SettingsSource): number | null {
  return profile.eligibleCustom ? profile.eligibleCents : tierAmount(tierAmountsFrom(settings), profile.tier);
}

/** Dollars (null/undefined = not set) to cents, or why not: $0.01 to $10,000,000 with at most two decimals. */
export function parseEligible(v: number | null | undefined, label = "eligible amount"): number | null | string {
  if (v === null || v === undefined) return null;
  const c = Math.round(v * 100);
  if (!Number.isSafeInteger(c) || c < 1 || c > MAX_CENTS || Math.abs(v * 100 - c) > 0.00001) return `The ${label} must be between $0.01 and $10,000,000, with at most two decimals.`;
  return c;
}

export function parseTierAmounts(input: { tier1?: number | null; tier2?: number | null; tier3?: number | null }): TierAmountsCents | string {
  const out: TierAmountsCents = { tier1: null, tier2: null, tier3: null };
  for (const t of [1, 2, 3] as const) {
    const c = parseEligible(input[`tier${t}`], `Tier ${t} amount`);
    if (typeof c === "string") return c;
    out[`tier${t}`] = c;
  }
  return out;
}

export const describeEligible = (cents: number | null) => (cents === null ? "not set" : usd(cents));
export const describeTierAmounts = (a: TierAmountsCents) =>
  ([1, 2, 3] as const).map((t) => `Tier ${t} ${describeEligible(a[`tier${t}`])}`).join(", ");

/** API shape: dollars, null = not set. */
export const centsOut = (c: number | null) => (c === null ? null : c / 100);
export const tierAmountsOut = (a: TierAmountsCents) => ({ tier1: centsOut(a.tier1), tier2: centsOut(a.tier2), tier3: centsOut(a.tier3) });
