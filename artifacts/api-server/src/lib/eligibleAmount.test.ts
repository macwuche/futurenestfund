import { describe, expect, it } from "vitest";
import { describeTierAmounts, effectiveEligible, parseEligible, parseTierAmounts, tierAmount, tierAmountsOut } from "./eligibleAmount";

const settings = { tier1EligibleCents: 500000, tier2EligibleCents: 2500000, tier3EligibleCents: null };

describe("eligible amount", () => {
  it("uses the amount for the user's tier unless they have a custom one, which replaces it", () => {
    expect(effectiveEligible({ tier: 1, eligibleCustom: false, eligibleCents: null }, settings)).toBe(500000);
    expect(effectiveEligible({ tier: 2, eligibleCustom: false, eligibleCents: 999 }, settings)).toBe(2500000);
    expect(effectiveEligible({ tier: 3, eligibleCustom: false, eligibleCents: null }, settings)).toBeNull();
    expect(effectiveEligible({ tier: 1, eligibleCustom: true, eligibleCents: 1234 }, settings)).toBe(1234);
    // A custom amount left empty means "not set" for that user, even when the tier has an amount.
    expect(effectiveEligible({ tier: 1, eligibleCustom: true, eligibleCents: null }, settings)).toBeNull();
    // Nothing saved yet (no settings row).
    expect(effectiveEligible({ tier: 1, eligibleCustom: false, eligibleCents: null }, undefined)).toBeNull();
  });

  it("treats tiers outside 1–3 as the nearest tier", () => {
    const a = { tier1: 1, tier2: 2, tier3: 3 };
    expect(tierAmount(a, 0)).toBe(1);
    expect(tierAmount(a, 7)).toBe(3);
  });

  it("parses amounts entered in dollars and refuses bad ones", () => {
    expect(parseEligible(null)).toBeNull();
    expect(parseEligible(undefined)).toBeNull();
    expect(parseEligible(75000)).toBe(7500000);
    expect(parseEligible(0.01)).toBe(1);
    expect(parseEligible(10_000_000)).toBe(1_000_000_000);
    for (const bad of [0, -5, 0.001, 10_000_000.01, Number.NaN, Number.POSITIVE_INFINITY]) expect(typeof parseEligible(bad)).toBe("string");
    expect(parseTierAmounts({ tier1: 5000, tier2: null })).toEqual({ tier1: 500000, tier2: null, tier3: null });
    expect(parseTierAmounts({ tier1: 5000, tier2: 1.234 })).toMatch(/Tier 2 amount/);
  });

  it("describes and returns amounts in dollars", () => {
    expect(describeTierAmounts({ tier1: 500000, tier2: null, tier3: 7500000 })).toBe("Tier 1 $5,000.00, Tier 2 not set, Tier 3 $75,000.00");
    expect(tierAmountsOut({ tier1: 500000, tier2: null, tier3: 1 })).toEqual({ tier1: 5000, tier2: null, tier3: 0.01 });
  });
});
