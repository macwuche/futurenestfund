import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, demoRequestsTable } from "@workspace/db";

/** Withdrawal limits in cents; null = no limit. */
export type Limits = { maxCents: number | null; dailyCents: number | null };
type LimitSource = { withdrawalLimitCustom: boolean; withdrawalMaxCents: number | null; withdrawalDailyCents: number | null };
/** The limits of the user's tier (Step 9.4: tier limits replaced the platform-wide ones). */
type TierSource = { withdrawalMaxCents: number | null; withdrawalDailyCents: number | null } | undefined;

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MAX_LIMIT_CENTS = 100000000;

/** A user's custom limits replace their tier's entirely (an empty custom field means no limit for that user). */
export function effectiveLimits(profile: LimitSource, tier: TierSource): Limits {
  return profile.withdrawalLimitCustom
    ? { maxCents: profile.withdrawalMaxCents, dailyCents: profile.withdrawalDailyCents }
    : { maxCents: tier?.withdrawalMaxCents ?? null, dailyCents: tier?.withdrawalDailyCents ?? null };
}

export type LimitNoun = { verb: string; noun: string; unit: string };
export const WITHDRAWAL: LimitNoun = { verb: "withdraw", noun: "withdrawal", unit: "request" };
export const TOP_UP: LimitNoun = { verb: "top up", noun: "card top-up", unit: "top-up" };

/** Which limit `amountCents` goes over, given what was already used in the last 24 hours. */
export function limitHit(limits: Limits, usedCents: number, amountCents: number): "max" | "daily" | null {
  if (limits.maxCents !== null && amountCents > limits.maxCents) return "max";
  if (limits.dailyCents !== null && usedCents + amountCents > limits.dailyCents) return "daily";
  return null;
}

/** Why `amountCents` is over a limit, given what was already used in the last 24 hours; null when it fits. */
export function limitProblem(limits: Limits, usedCents: number, amountCents: number, what: LimitNoun = WITHDRAWAL): string | null {
  const hit = limitHit(limits, usedCents, amountCents);
  if (hit === "max") return `You can ${what.verb} up to ${usd(limits.maxCents!)} per ${what.unit}.`;
  if (hit === "daily") {
    const left = Math.max(0, limits.dailyCents! - usedCents);
    return left === 0
      ? `You've reached your ${usd(limits.dailyCents!)} daily ${what.noun} limit. Try again once earlier ${what.noun}s are more than 24 hours old.`
      : `You have ${usd(left)} left of your ${usd(limits.dailyCents!)} daily ${what.noun} limit (last 24 hours).`;
  }
  return null;
}

/**
 * Turns limits entered in dollars (null/undefined = no limit) into cents, or explains what's wrong:
 * $0.01 to $1,000,000 with two decimals, and a daily total no lower than the per-request limit.
 */
export function parseLimits(input: { maxPerRequest?: number | null; dailyTotal?: number | null }): Limits | string {
  const cents = (v: number | null | undefined, label: string): number | null | string => {
    if (v === null || v === undefined) return null;
    const c = Math.round(v * 100);
    if (!Number.isSafeInteger(c) || c < 1 || c > MAX_LIMIT_CENTS || Math.abs(v * 100 - c) > 0.00001) return `The ${label} must be between $0.01 and $1,000,000, with at most two decimals.`;
    return c;
  };
  const maxCents = cents(input.maxPerRequest, "limit per request");
  if (typeof maxCents === "string") return maxCents;
  const dailyCents = cents(input.dailyTotal, "daily total");
  if (typeof dailyCents === "string") return dailyCents;
  if (maxCents !== null && dailyCents !== null && dailyCents < maxCents) return "The daily total can't be lower than the limit per request.";
  return { maxCents, dailyCents };
}

export const describeLimits = (l: Limits, unit = "request") =>
  `${l.maxCents === null ? `no limit per ${unit}` : `${usd(l.maxCents)} per ${unit}`}, ${l.dailyCents === null ? "no daily limit" : `${usd(l.dailyCents)} per 24 hours`}`;

/** Withdrawals under review or approved in the last 24 hours, per user (declined ones don't count). */
export async function withdrawnLast24h(profileIds: string[], tx: Pick<typeof db, "select"> = db): Promise<Map<string, number>> {
  if (!profileIds.length) return new Map();
  const rows = await tx.select({ profileId: demoRequestsTable.profileId, sum: sql<number>`coalesce(sum(${demoRequestsTable.amountCents}), 0)::int` })
    .from(demoRequestsTable)
    .where(and(inArray(demoRequestsTable.profileId, profileIds), eq(demoRequestsTable.kind, "Withdrawal"),
      inArray(demoRequestsTable.status, ["Pending", "Completed"]), gt(demoRequestsTable.createdAt, sql`now() - interval '24 hours'`)))
    .groupBy(demoRequestsTable.profileId);
  return new Map(rows.map(r => [r.profileId, r.sum]));
}

/** API shape: dollars, null = no limit. */
export const limitsOut = (l: Limits) => ({ maxPerRequest: l.maxCents === null ? null : l.maxCents / 100, dailyTotal: l.dailyCents === null ? null : l.dailyCents / 100 });
