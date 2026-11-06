/**
 * Pure rules for tiers (Step 9.4): what each tier (1–3) allows — withdrawal limits, card top-up limits, which card types
 * and kinds it may buy — and the form a user fills in to move up to it. Set in Admin Settings → Tiers and stored in
 * `demo_settings.tier_rules` (jsonb). No database access here, so it's unit-tested directly.
 *
 * Tier withdrawal limits are the standard every user follows; a user's custom limits (user inspector) replace them for
 * that user. Upgrades go one tier at a time and an administrator approves each one.
 */
import { CARD_TYPES, cardTypeInfo, isCardType, type CardKind, type CardTypeKey, type CardTypeSettings } from "./cardTypes";
import { parseFields, PLAN_FIELD_TYPES, type MethodField } from "./paymentRules";
import { parseLimits, type Limits } from "./withdrawalLimits";

/**
 * A request refused by a tier limit (or a card the tier can't buy). `upgradeTier` is the tier that would lift it, so the
 * app can show an Upgrade button; the API sends it alongside the message (app.ts). `blocked` names what was refused.
 */
export class TierLimitError extends Error {
  constructor(message: string, readonly upgradeTier: Tier | null, readonly blocked?: string) { super(message); }
}

export const TIERS = [1, 2, 3] as const;
export type Tier = (typeof TIERS)[number];
export const TOP_TIER: Tier = 3;
export const isTier = (v: unknown): v is Tier => v === 1 || v === 2 || v === 3;

export const FORM_LIMITS = { intro: 2000, fields: 30, fileFields: 10 } as const;

export type CardAllowance = Record<CardTypeKey, { virtual: boolean; physical: boolean }>;
export type UpgradeForm = { intro: string; fields: MethodField[] };
export type TierRule = {
  /** Withdrawals per request and per 24 hours, in cents; null = no limit. */
  withdrawalMaxCents: number | null; withdrawalDailyCents: number | null;
  /** Card top-ups per top-up and per 24 hours, in cents; null = no limit. */
  topUpMaxCents: number | null; topUpDailyCents: number | null;
  /** Which card types and kinds this tier may buy (Settings → Cards still decides what's on sale and its price). */
  cards: CardAllowance;
  /** The form to fill in to move up *to* this tier; always null for Tier 1. null = this tier can't be asked for yet. */
  upgradeForm: UpgradeForm | null;
};
export type TierRules = Record<Tier, TierRule>;

const allCards = (): CardAllowance => Object.fromEntries(CARD_TYPES.map(t => [t.key, { virtual: true, physical: true }])) as CardAllowance;

const centsOrNull = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 100_000_000 ? v : null);
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim() : "");

function storedForm(raw: unknown): UpgradeForm | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { intro?: unknown; fields?: unknown };
  const fields = parseFields(r.fields, PLAN_FIELD_TYPES, FORM_LIMITS.fields, "An upgrade form");
  return { intro: clean(r.intro).slice(0, FORM_LIMITS.intro), fields: typeof fields === "string" ? [] : fields };
}

/**
 * The stored rules with every tier and card type present. Before 9.4 there were no tier rules: `legacy` (the old
 * platform-wide withdrawal limits) then stands in for every tier's withdrawal limits; everything else starts open
 * (no top-up limits, every card allowed) and no tier has an upgrade form.
 */
export function storedTierRules(raw: unknown, legacy?: { withdrawalMaxCents: number | null; withdrawalDailyCents: number | null }): TierRules {
  const all = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  return Object.fromEntries(TIERS.map(t => {
    const s = all[String(t)];
    const cards = allCards();
    const rawCards = (s?.["cards"] ?? {}) as Record<string, { virtual?: unknown; physical?: unknown } | undefined>;
    for (const c of CARD_TYPES) {
      const v = rawCards[c.key];
      if (v) cards[c.key] = { virtual: v.virtual !== false, physical: v.physical !== false };
    }
    const rule: TierRule = {
      withdrawalMaxCents: s ? centsOrNull(s["withdrawalMaxCents"]) : legacy?.withdrawalMaxCents ?? null,
      withdrawalDailyCents: s ? centsOrNull(s["withdrawalDailyCents"]) : legacy?.withdrawalDailyCents ?? null,
      topUpMaxCents: centsOrNull(s?.["topUpMaxCents"]),
      topUpDailyCents: centsOrNull(s?.["topUpDailyCents"]),
      cards,
      upgradeForm: t === 1 ? null : storedForm(s?.["upgradeForm"]),
    };
    return [t, rule];
  })) as TierRules;
}

type LimitsInput = { maxPerRequest?: unknown; dailyTotal?: unknown } | null | undefined;
export type TierInput = {
  tier?: unknown; withdrawal?: LimitsInput; topUp?: LimitsInput;
  cards?: unknown; upgradeForm?: { intro?: unknown; fields?: unknown } | null;
};

function limits(input: LimitsInput, what: string): Limits | string {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : typeof v === "number" ? v : NaN);
  const parsed = parseLimits({ maxPerRequest: num(input?.maxPerRequest), dailyTotal: num(input?.dailyTotal) });
  return typeof parsed === "string" ? `${what}: ${parsed.charAt(0).toLowerCase()}${parsed.slice(1)}` : parsed;
}

/** Check what the admin sent ({ tiers: [TierInput, …] }) and normalise it; tiers not sent keep their current rules. */
export function parseTierRules(input: unknown, current: TierRules): TierRules | string {
  const list = (input as { tiers?: unknown } | null)?.tiers;
  if (!Array.isArray(list) || list.length === 0) return "The tier settings couldn't be read.";
  const next = structuredClone(current);
  const seen = new Set<Tier>();
  for (const raw of list as TierInput[]) {
    const tier = raw?.tier;
    if (!isTier(tier)) return "Unknown tier.";
    if (seen.has(tier)) return `Tier ${tier} is listed twice.`;
    seen.add(tier);
    const w = limits(raw.withdrawal, `Tier ${tier} withdrawals`);
    if (typeof w === "string") return w;
    const top = limits(raw.topUp, `Tier ${tier} card top-ups`);
    if (typeof top === "string") return top;
    const cards = allCards();
    if (raw.cards !== undefined) {
      if (!Array.isArray(raw.cards)) return `Tier ${tier}: the card list couldn't be read.`;
      for (const c of raw.cards as { key?: unknown; virtual?: unknown; physical?: unknown }[]) {
        if (!isCardType(c?.key)) return `Tier ${tier}: unknown card type.`;
        cards[c.key] = { virtual: c.virtual === true, physical: c.physical === true };
      }
    }
    let upgradeForm: UpgradeForm | null = null;
    if (raw.upgradeForm) {
      if (tier === 1) return "Tier 1 is where everyone starts, so it has no upgrade form.";
      const intro = clean(raw.upgradeForm.intro);
      if (intro.length > FORM_LIMITS.intro) return `Tier ${tier}: keep the introduction under ${FORM_LIMITS.intro.toLocaleString("en-US")} characters.`;
      const fields = parseFields(raw.upgradeForm.fields, PLAN_FIELD_TYPES, FORM_LIMITS.fields, `The Tier ${tier} upgrade form`);
      if (typeof fields === "string") return fields;
      if (fields.length === 0) return `Tier ${tier}: add at least one field to the upgrade form, or switch the form off.`;
      if (fields.filter(f => f.type === "file").length > FORM_LIMITS.fileFields) return `The Tier ${tier} upgrade form can ask for at most ${FORM_LIMITS.fileFields} files.`;
      upgradeForm = { intro, fields };
    }
    next[tier] = {
      withdrawalMaxCents: w.maxCents, withdrawalDailyCents: w.dailyCents, topUpMaxCents: top.maxCents, topUpDailyCents: top.dailyCents,
      cards, upgradeForm,
    };
  }
  return next;
}

export const withdrawalLimitsOf = (r: TierRule) => ({ withdrawalMaxCents: r.withdrawalMaxCents, withdrawalDailyCents: r.withdrawalDailyCents });
export const topUpLimitsOf = (r: TierRule): Limits => ({ maxCents: r.topUpMaxCents, dailyCents: r.topUpDailyCents });

export const tierOf = (v: unknown): Tier => (isTier(v) ? v : 1);
/** The tier a user on `tier` can ask for next: one up, and only when it has an upgrade form. */
export function nextTier(rules: TierRules, tier: number): Tier | null {
  const t = tierOf(tier);
  if (t >= TOP_TIER) return null;
  const up = (t + 1) as Tier;
  return rules[up].upgradeForm ? up : null;
}

const kindKey = (k: CardKind) => (k === "Virtual" ? "virtual" : "physical");
export const cardAllowed = (rules: TierRules, tier: number, type: CardTypeKey, kind: CardKind) => rules[tierOf(tier)].cards[type][kindKey(kind)];
/** The lowest tier above `tier` that may buy this card, for "Reach Tier 3 to buy it"; null when none may. */
export function tierNeededFor(rules: TierRules, tier: number, type: CardTypeKey, kind: CardKind): Tier | null {
  for (const t of TIERS) if (t > tierOf(tier) && rules[t].cards[type][kindKey(kind)]) return t;
  return null;
}

/** Sold kinds: a type that's on sale, with a price for that kind. */
const sold = (cards: CardTypeSettings, type: CardTypeKey, kind: "virtual" | "physical") => cards[type].enabled && cards[type][kind].priceCents !== null;

/**
 * Setup problems the admin should know about (saving still works). No physical card without a virtual card: a tier that
 * may buy a physical card on sale, but no virtual card on sale, leaves its users unable to get that physical card.
 */
export function tierWarnings(rules: TierRules, cards: CardTypeSettings): string[] {
  const out: string[] = [];
  for (const t of TIERS) {
    const physical = CARD_TYPES.filter(c => rules[t].cards[c.key].physical && sold(cards, c.key, "physical")).map(c => c.name);
    const virtual = CARD_TYPES.some(c => rules[t].cards[c.key].virtual && sold(cards, c.key, "virtual"));
    if (physical.length && !virtual) {
      out.push(`Tier ${t} can buy the ${physical.join(", ")} physical card${physical.length > 1 ? "s" : ""}, but no virtual card, and a physical card needs a virtual card first. Nobody on Tier ${t} can get ${physical.length > 1 ? "them" : "it"}: allow a virtual card for Tier ${t}.`);
    }
  }
  return out;
}

/** One line per tier for the audit log. */
export function describeTier(t: Tier, r: TierRule): string {
  const usd = (c: number | null) => (c === null ? "no limit" : `$${(c / 100).toFixed(2)}`);
  const cards = CARD_TYPES.flatMap(c => [
    ...(r.cards[c.key].virtual ? [`${cardTypeInfo(c.key).name} virtual`] : []), ...(r.cards[c.key].physical ? [`${cardTypeInfo(c.key).name} physical`] : []),
  ]);
  return `Tier ${t}: withdrawals ${usd(r.withdrawalMaxCents)} per request / ${usd(r.withdrawalDailyCents)} per 24 h; top-ups ${usd(r.topUpMaxCents)} each / ${usd(r.topUpDailyCents)} per 24 h; cards ${cards.length ? cards.join(", ") : "none"}${t === 1 ? "" : `; upgrade form ${r.upgradeForm ? `${r.upgradeForm.fields.length} field(s)` : "off"}`}`;
}
