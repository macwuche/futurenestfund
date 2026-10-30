import { describe, expect, it } from "vitest";
import { effectiveLimits, limitProblem, parseLimits } from "./withdrawalLimits";

describe("withdrawal limits", () => {
  const global = { withdrawalMaxCents: 50000, withdrawalDailyCents: 100000 };
  it("uses the global limits unless the user has custom ones, which replace them entirely", () => {
    expect(effectiveLimits({ withdrawalLimitCustom: false, withdrawalMaxCents: 1, withdrawalDailyCents: 1 }, global)).toEqual({ maxCents: 50000, dailyCents: 100000 });
    expect(effectiveLimits({ withdrawalLimitCustom: true, withdrawalMaxCents: 200000, withdrawalDailyCents: null }, global)).toEqual({ maxCents: 200000, dailyCents: null });
    expect(effectiveLimits({ withdrawalLimitCustom: false, withdrawalMaxCents: null, withdrawalDailyCents: null }, undefined)).toEqual({ maxCents: null, dailyCents: null });
  });
  it("checks the per-request limit, then the 24-hour total", () => {
    const l = { maxCents: 50000, dailyCents: 100000 };
    expect(limitProblem(l, 0, 50000)).toBeNull();
    expect(limitProblem(l, 0, 50001)).toBe("You can withdraw up to $500.00 per request.");
    expect(limitProblem(l, 60000, 40000)).toBeNull();
    expect(limitProblem(l, 60000, 40001)).toBe("You have $400.00 left of your $1,000.00 daily withdrawal limit (last 24 hours).");
    expect(limitProblem(l, 100000, 1)).toContain("You've reached your $1,000.00 daily withdrawal limit");
    expect(limitProblem({ maxCents: null, dailyCents: null }, 10 ** 9, 10 ** 8)).toBeNull();
  });
  it("parses limits entered in dollars and refuses bad ones", () => {
    expect(parseLimits({ maxPerRequest: 500, dailyTotal: 1000.5 })).toEqual({ maxCents: 50000, dailyCents: 100050 });
    expect(parseLimits({ maxPerRequest: null })).toEqual({ maxCents: null, dailyCents: null });
    expect(parseLimits({ maxPerRequest: 0 })).toContain("between $0.01 and $1,000,000");
    expect(parseLimits({ dailyTotal: 1.234 })).toContain("two decimals");
    expect(parseLimits({ maxPerRequest: 2000000 })).toContain("between");
    expect(parseLimits({ maxPerRequest: 500, dailyTotal: 100 })).toBe("The daily total can't be lower than the limit per request.");
  });
});
