import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, demoRequestsTable } from "@workspace/db";

/** Withdrawal limits in cents; null = no limit. */
export type Limits = { maxCents: number | null; dailyCents: number | null };
type LimitSource = { withdrawalLimitCustom: boolean; withdrawalMaxCents: number | null; withdrawalDailyCents: number | null };
type GlobalSource = { withdrawalMaxCents: number | null; withdrawalDailyCents: number | null } | undefined;

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MAX_LIMIT_CENTS = 100000000;

/** A user's custom limits replace the global ones entirely (an empty custom field means no limit for that user). */
export function effectiveLimits(profile: LimitSource, global: GlobalSource): Limits {
  return profile.withdrawalLimitCustom
    ? { maxCents: profile.withdrawalMaxCents, dailyCents: profile.withdrawalDailyCents }
    : { maxCents: global?.withdrawalMaxCents ?? null, dailyCents: global?.withdrawalDailyCents ?? null };
}

/** Why a withdrawal of `amountCents` is over a limit, given what was already used in the last 24 hours; null when it fits. */
export function limitProblem(limits: Limits, usedCents: number, amountCents: number): string | null {
  if (limits.maxCents !== null && amountCents > limits.maxCents) return `You can withdraw up to ${usd(limits.maxCents)} per request.`;
  if (limits.dailyCents !== null && usedCents + amountCents > limits.dailyCents) {
    const left = Math.max(0, limits.dailyCents - usedCents);
    return left === 0
      ? `You've reached your ${usd(limits.dailyCents)} daily withdrawal limit. Try again once earlier requests are more than 24 hours old.`
      : `You have ${usd(left)} left of your ${usd(limits.dailyCents)} daily withdrawal limit (last 24 hours).`;
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

export const describeLimits = (l: Limits) =>
  `${l.maxCents === null ? "no limit per request" : `${usd(l.maxCents)} per request`}, ${l.dailyCents === null ? "no daily limit" : `${usd(l.dailyCents)} per 24 hours`}`;

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
