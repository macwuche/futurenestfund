import { describe, expect, it } from "vitest";
import { describeFee, feeCents, parseFee, storedFee } from "./fees";

describe("parseFee", () => {
  it("reads fixed amounts and percentages as whole numbers", () => {
    expect(parseFee({ mode: "fixed", amount: 1 })).toEqual({ mode: "fixed", value: 100 });
    expect(parseFee({ mode: "percent", amount: 1.5 })).toEqual({ mode: "percent", value: 150 });
    expect(parseFee({ mode: "percent", amount: 0 })).toEqual({ mode: "percent", value: 0 });
  });
  it("treats missing as no fee", () => {
    expect(parseFee(undefined)).toEqual({ mode: "fixed", value: 0 });
    expect(parseFee(null)).toEqual({ mode: "fixed", value: 0 });
    expect(parseFee({ mode: "fixed", amount: null })).toEqual({ mode: "fixed", value: 0 });
  });
  it("refuses negative, too many decimals, over 100%, over $1,000,000 and bad modes", () => {
    expect(parseFee({ mode: "fixed", amount: -1 })).toMatch(/negative/);
    expect(parseFee({ mode: "percent", amount: -0.01 })).toMatch(/negative/);
    expect(parseFee({ mode: "fixed", amount: 1.234 })).toMatch(/two decimals/);
    expect(parseFee({ mode: "percent", amount: 100.01 })).toMatch(/100%/);
    expect(parseFee({ mode: "fixed", amount: 1_000_000.01 })).toMatch(/1,000,000/);
    expect(parseFee({ mode: "other", amount: 1 })).toMatch(/choose/);
    expect(parseFee({ mode: "fixed", amount: "1" })).toMatch(/number/);
  });
});

describe("feeCents", () => {
  it("matches the user's examples: $10 at 1% is $0.10; $10 + $1 fixed is $1", () => {
    expect(feeCents({ mode: "percent", value: 100 }, 1000)).toBe(10);
    expect(feeCents({ mode: "fixed", value: 100 }, 1000)).toBe(100);
  });
  it("rounds a percentage to the nearest cent, half up", () => {
    expect(feeCents({ mode: "percent", value: 150 }, 333)).toBe(5); // 4.995 → 5
    expect(feeCents({ mode: "percent", value: 100 }, 149)).toBe(1); // 1.49 → 1
    expect(feeCents({ mode: "percent", value: 100 }, 150)).toBe(2); // 1.5 → 2
  });
  it("is 0 with no fee", () => {
    expect(feeCents({ mode: "percent", value: 0 }, 5000)).toBe(0);
    expect(feeCents({ mode: "fixed", value: 0 }, 5000)).toBe(0);
  });
});

describe("storedFee and describeFee", () => {
  it("never returns a negative or unreadable rule", () => {
    expect(storedFee("percent", -5)).toEqual({ mode: "percent", value: 0 });
    expect(storedFee("whatever", 250)).toEqual({ mode: "fixed", value: 250 });
    expect(storedFee("fixed", "x")).toEqual({ mode: "fixed", value: 0 });
  });
  it("reads well", () => {
    expect(describeFee({ mode: "fixed", value: 0 })).toBe("No fee");
    expect(describeFee({ mode: "fixed", value: 100 })).toBe("Fee $1.00");
    expect(describeFee({ mode: "percent", value: 100 }, 1000)).toBe("Fee 1% ($0.10)");
    expect(describeFee({ mode: "percent", value: 250 })).toBe("Fee 2.5%");
  });
});
