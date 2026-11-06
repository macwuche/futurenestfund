import { describe, expect, it } from "vitest";
import { cardTypeSettings } from "./cardTypes";
import { cardAllowed, nextTier, parseTierRules, storedTierRules, tierNeededFor, tierWarnings, topUpLimitsOf, withdrawalLimitsOf, type TierRules } from "./tierRules";
import { effectiveLimits, limitProblem, TOP_UP } from "./withdrawalLimits";

const legacy = { withdrawalMaxCents: 50000, withdrawalDailyCents: 100000 };
const field = (label: string, type = "text") => ({ label, type, required: true });
const tier = (t: number, extra: Record<string, unknown> = {}) => ({ tier: t, withdrawal: { maxPerRequest: null, dailyTotal: null }, topUp: { maxPerRequest: null, dailyTotal: null }, ...extra });

describe("storedTierRules", () => {
  it("before any tier rules: the old platform-wide limits for every tier, everything else open", () => {
    const r = storedTierRules(null, legacy);
    for (const t of [1, 2, 3] as const) {
      expect(withdrawalLimitsOf(r[t])).toEqual(legacy);
      expect(topUpLimitsOf(r[t])).toEqual({ maxCents: null, dailyCents: null });
      expect(r[t].cards["amex-platinum"]).toEqual({ virtual: true, physical: true });
      expect(r[t].upgradeForm).toBeNull();
    }
  });
  it("migration 0012's shape: withdrawal limits only, the rest filled in", () => {
    const r = storedTierRules({ "1": { withdrawalMaxCents: 100, withdrawalDailyCents: null } }, legacy);
    expect(withdrawalLimitsOf(r[1])).toEqual({ withdrawalMaxCents: 100, withdrawalDailyCents: null });
    expect(withdrawalLimitsOf(r[2])).toEqual(legacy);
  });
  it("ignores bad stored values and never gives Tier 1 a form", () => {
    const r = storedTierRules({ "1": { withdrawalMaxCents: -5, upgradeForm: { intro: "x", fields: [field("Name")] } } });
    expect(r[1].withdrawalMaxCents).toBeNull();
    expect(r[1].upgradeForm).toBeNull();
  });
});

describe("parseTierRules", () => {
  const base = storedTierRules(null, legacy);
  it("saves limits in cents and the card grid", () => {
    const r = parseTierRules({ tiers: [tier(1, {
      withdrawal: { maxPerRequest: 500, dailyTotal: 1000 }, topUp: { maxPerRequest: 200, dailyTotal: 500 },
      cards: [{ key: "visa-debit", virtual: true, physical: true }, { key: "amex-platinum", virtual: false, physical: false }],
    })] }, base) as TierRules;
    expect(withdrawalLimitsOf(r[1])).toEqual({ withdrawalMaxCents: 50000, withdrawalDailyCents: 100000 });
    expect(topUpLimitsOf(r[1])).toEqual({ maxCents: 20000, dailyCents: 50000 });
    expect(r[1].cards["visa-debit"]).toEqual({ virtual: true, physical: true });
    expect(r[1].cards["amex-platinum"]).toEqual({ virtual: false, physical: false });
    expect(r[2]).toEqual(base[2]);
  });
  it("refuses bad limits, unknown tiers and duplicates", () => {
    expect(parseTierRules({ tiers: [tier(1, { withdrawal: { maxPerRequest: 500, dailyTotal: 100 } })] }, base)).toMatch(/Tier 1 withdrawals: the daily total can't be lower/);
    expect(parseTierRules({ tiers: [tier(2, { topUp: { maxPerRequest: 0.001, dailyTotal: null } })] }, base)).toMatch(/Tier 2 card top-ups/);
    expect(parseTierRules({ tiers: [tier(4)] }, base)).toBe("Unknown tier.");
    expect(parseTierRules({ tiers: [tier(2), tier(2)] }, base)).toBe("Tier 2 is listed twice.");
    expect(parseTierRules({ tiers: [tier(1, { cards: [{ key: "diners", virtual: true, physical: true }] })] }, base)).toMatch(/unknown card type/);
  });
  it("upgrade forms: not on Tier 1, at least one field, at most 10 files, field ids kept", () => {
    expect(parseTierRules({ tiers: [tier(1, { upgradeForm: { intro: "", fields: [field("A")] } })] }, base)).toMatch(/Tier 1.*no upgrade form/);
    expect(parseTierRules({ tiers: [tier(2, { upgradeForm: { intro: "", fields: [] } })] }, base)).toMatch(/at least one field/);
    const files = Array.from({ length: 11 }, (_, i) => field(`File ${i}`, "file"));
    expect(parseTierRules({ tiers: [tier(2, { upgradeForm: { intro: "", fields: files } })] }, base)).toMatch(/at most 10 files/);
    const r = parseTierRules({ tiers: [tier(2, { upgradeForm: { intro: " Send your ID ", fields: [{ ...field("Passport", "file"), id: "abc123def0" }] } })] }, base) as TierRules;
    expect(r[2].upgradeForm).toEqual({ intro: "Send your ID", fields: [{ id: "abc123def0", label: "Passport", type: "file", required: true }] });
  });
});

describe("tier rules in use", () => {
  const rules = parseTierRules({ tiers: [
    tier(1, { cards: [{ key: "visa-debit", virtual: true, physical: true }, { key: "amex-platinum", virtual: false, physical: false }] }),
    tier(2, { upgradeForm: { intro: "", fields: [field("ID")] }, cards: [{ key: "amex-platinum", virtual: false, physical: false }] }),
    tier(3, { upgradeForm: { intro: "", fields: [field("Proof")] } }),
  ] }, storedTierRules(null)) as TierRules;
  it("which cards a tier may buy, and the tier that can", () => {
    expect(cardAllowed(rules, 1, "visa-debit", "Physical")).toBe(true);
    expect(cardAllowed(rules, 1, "amex-platinum", "Virtual")).toBe(false);
    expect(tierNeededFor(rules, 1, "amex-platinum", "Virtual")).toBe(3);
    expect(tierNeededFor(rules, 3, "amex-platinum", "Virtual")).toBeNull();
  });
  it("one tier at a time, only to a tier with a form", () => {
    expect(nextTier(rules, 1)).toBe(2);
    expect(nextTier(rules, 2)).toBe(3);
    expect(nextTier(rules, 3)).toBeNull();
    expect(nextTier(storedTierRules(null), 1)).toBeNull();
  });
  it("custom limits replace the tier's; top-up wording", () => {
    const t = { withdrawalMaxCents: 50000, withdrawalDailyCents: null };
    expect(effectiveLimits({ withdrawalLimitCustom: false, withdrawalMaxCents: 1, withdrawalDailyCents: 1 }, t)).toEqual({ maxCents: 50000, dailyCents: null });
    expect(effectiveLimits({ withdrawalLimitCustom: true, withdrawalMaxCents: null, withdrawalDailyCents: 900 }, t)).toEqual({ maxCents: null, dailyCents: 900 });
    expect(limitProblem({ maxCents: 20000, dailyCents: null }, 0, 20001, TOP_UP)).toBe("You can top up up to $200.00 per top-up.");
    expect(limitProblem({ maxCents: null, dailyCents: 50000 }, 40000, 20000, TOP_UP)).toBe("You have $100.00 left of your $500.00 daily card top-up limit (last 24 hours).");
  });
});

describe("tierWarnings", () => {
  const onSale = cardTypeSettings({
    "visa-debit": { enabled: true, virtual: { priceCents: 500 }, physical: { priceCents: 1000 } },
    "amex-platinum": { enabled: true, virtual: { priceCents: null }, physical: { priceCents: 5000 } },
  });
  it("a tier with a physical card on sale but no virtual card", () => {
    const rules = parseTierRules({ tiers: [tier(1, { cards: [{ key: "visa-debit", virtual: false, physical: true }, { key: "amex-platinum", virtual: true, physical: false }] })] }, storedTierRules(null)) as TierRules;
    const w = tierWarnings(rules, onSale);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^Tier 1 can buy the Visa Debit physical card, but no virtual card/);
  });
  it("none when a virtual card is allowed, or nothing physical is on sale", () => {
    expect(tierWarnings(storedTierRules(null), onSale)).toEqual([]);
    const rules = parseTierRules({ tiers: [tier(2, { cards: [] })] }, storedTierRules(null)) as TierRules;
    expect(tierWarnings(rules, onSale)).toEqual([]);
  });
});
