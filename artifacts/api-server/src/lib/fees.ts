/**
 * Fees (Step 9.3): one rule shape for every fee: a fixed amount or a percentage of a base amount, never negative.
 * Stored as whole numbers: `value` is cents for a fixed fee, hundredths of a percent for a percentage (1% = 100).
 * Pure, so it's unit-tested directly.
 */
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type FeeMode = "fixed" | "percent";
export type FeeRule = { mode: FeeMode; value: number };
export const NO_FEE: FeeRule = { mode: "fixed", value: 0 };

const MAX_FIXED_CENTS = 100_000_000; // $1,000,000
const MAX_PERCENT_HUNDREDTHS = 10_000; // 100%

/** A stored rule back to a safe one (anything unreadable counts as no fee). */
export function storedFee(mode: unknown, value: unknown): FeeRule {
  const v = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return mode === "percent" ? { mode: "percent", value: Math.min(v, MAX_PERCENT_HUNDREDTHS) } : { mode: "fixed", value: Math.min(v, MAX_FIXED_CENTS) };
}

/**
 * The rule an administrator sends ({ mode, amount } in dollars or percent) to a stored rule, or what's wrong with it.
 * Missing or null means no fee.
 */
export function parseFee(input: unknown, what = "The fee"): FeeRule | string {
  if (input === undefined || input === null) return NO_FEE;
  if (typeof input !== "object" || Array.isArray(input)) return `${what} couldn't be read.`;
  const { mode, amount } = input as { mode?: unknown; amount?: unknown };
  if (mode !== "fixed" && mode !== "percent") return `${what}: choose a fixed amount or a percentage.`;
  if (amount === undefined || amount === null || amount === "") return { mode, value: 0 };
  if (typeof amount !== "number" || !Number.isFinite(amount)) return `${what} must be a number.`;
  if (amount < 0) return `${what} can't be negative.`;
  const v = Math.round(amount * 100);
  if (Math.abs(amount * 100 - v) > 0.00001) return `${what} can have at most two decimals.`;
  if (mode === "percent" && v > MAX_PERCENT_HUNDREDTHS) return `${what} can't be more than 100%.`;
  if (mode === "fixed" && v > MAX_FIXED_CENTS) return `${what} can't be more than $1,000,000.`;
  return { mode, value: v };
}

/** The fee on `baseCents`, in cents: a fixed fee as is; a percentage rounded to the nearest cent (half up). */
export function feeCents(rule: FeeRule, baseCents: number): number {
  if (rule.value <= 0) return 0;
  if (rule.mode === "fixed") return rule.value;
  return Math.floor((baseCents * rule.value + 5_000) / 10_000);
}

const pct = (hundredths: number) => `${(hundredths / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** "No fee", "Fee $1.00", "Fee 1%", or with a base: "Fee 1% ($0.10)". */
export function describeFee(rule: FeeRule, baseCents?: number): string {
  if (rule.value <= 0) return "No fee";
  if (rule.mode === "fixed") return `Fee ${usd(rule.value)}`;
  return baseCents === undefined ? `Fee ${pct(rule.value)}` : `Fee ${pct(rule.value)} (${usd(feeCents(rule, baseCents))})`;
}

/** The rule as the API shows it: { mode, amount } in dollars (fixed) or percent. */
export const feeOut = (rule: FeeRule) => ({ mode: rule.mode, amount: rule.value / 100 });
