import { describe, expect, it } from "vitest";
import { awardCents, awardText, parsePlan, planInitials, requestedCents } from "./grantPlanRules";
import { parseAnswers, parseFields, FIELD_TYPES, PLAN_FIELD_TYPES } from "./paymentRules";
import { feeCents } from "./fees";

const EDU = "8ce10cdc-114a-4a9d-a365-f855a54294de";
const ok = (input: Parameters<typeof parsePlan>[0]) => {
  const r = parsePlan(input);
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe("parsePlan", () => {
  it("normalises a full plan", () => {
    const p = ok({
      name: "  School   Grant ", description: "Line one\r\nLine two", industryId: EDU, amount: 5000, fee: { mode: "fixed", amount: 2 },
      fields: [{ label: "Full name", type: "text" }, { label: "ID document", type: "file", required: true }, { label: "Level", type: "select", options: ["A", "A", "B"] }],
    });
    expect(p).toMatchObject({ name: "School Grant", description: "Line one\nLine two", industryId: EDU, amountCents: 500000, fee: { mode: "fixed", value: 200 }, enabled: true });
    expect(p.fields.map(f => f.type)).toEqual(["text", "file", "select"]);
    expect(p.fields[2]!.options).toEqual(["A", "B"]);
    expect(p.fields.every(f => /^[a-f0-9]{10}$/.test(f.id))).toBe(true);
  });
  it("empty or missing industry means all industries; a bad one is refused", () => {
    expect(ok({ name: "Open", amount: 10 }).industryId).toBeNull();
    expect(ok({ name: "Open", amount: 10, industryId: "" }).industryId).toBeNull();
    expect(parsePlan({ name: "Open", amount: 10, industryId: "education" })).toMatch(/industry/);
  });
  it("checks the name, description and award", () => {
    expect(parsePlan({ name: "X", amount: 10 })).toMatch(/name of 2–80/);
    expect(parsePlan({ name: "Ok", amount: 10, description: "x".repeat(2001) })).toMatch(/description/);
    expect(parsePlan({ name: "Ok", amount: 0.5 })).toMatch(/between \$1 and \$10,000,000/);
    expect(parsePlan({ name: "Ok", amount: 10_000_000.01 })).toMatch(/between/);
    expect(parsePlan({ name: "Ok", amount: 1.234 })).toMatch(/two decimals/);
    expect(parsePlan({ name: "Ok", amount: "100" })).toMatch(/between/);
  });
  it("the fee is fixed or a percentage of the award, never more than the award", () => {
    expect(ok({ name: "Ok", amount: 1000, fee: { mode: "percent", amount: 5 } }).fee).toEqual({ mode: "percent", value: 500 });
    expect(parsePlan({ name: "Ok", amount: 10, fee: { mode: "fixed", amount: 20 } })).toMatch(/more than the award/);
    expect(parsePlan({ name: "Ok", amount: 10, fee: { mode: "fixed", amount: -1 } })).toMatch(/application charge can't be negative/i);
    expect(ok({ name: "Ok", amount: 10 }).fee).toEqual({ mode: "fixed", value: 0 });
    expect(feeCents({ mode: "percent", value: 150 }, 123456)).toBe(1852); // 1.5% of $1,234.56 = $18.5184 → $18.52
  });
  it("limits the form: 30 fields, 10 of them files", () => {
    const many = (n: number, type = "text") => Array.from({ length: n }, (_, i) => ({ label: `F${i}`, type }));
    expect(parsePlan({ name: "Ok", amount: 10, fields: many(31) })).toMatch(/at most 30 fields/);
    expect(parsePlan({ name: "Ok", amount: 10, fields: many(11, "file") })).toMatch(/at most 10 files/);
    expect(ok({ name: "Ok", amount: 10, fields: many(10, "file") }).fields).toHaveLength(10);
  });
  it("switched off when enabled is false", () => {
    expect(ok({ name: "Ok", amount: 10, enabled: false }).enabled).toBe(false);
  });
});

describe("form fields", () => {
  it("only grant plans may have file fields", () => {
    expect(parseFields([{ label: "Doc", type: "file" }], FIELD_TYPES, 20, "A method")).toMatch(/choose a type/);
    expect(parseFields([{ label: "Doc", type: "file" }], PLAN_FIELD_TYPES, 20, "A plan's form")).toHaveLength(1);
  });
  it("answers skip file fields (the files are checked where they arrive)", () => {
    const fields = [{ id: "aaaaaa", label: "Name", type: "text" as const, required: true }, { id: "bbbbbb", label: "Doc", type: "file" as const, required: true }];
    expect(parseAnswers(fields, { aaaaaa: "Jane", bbbbbb: "ignored" })).toEqual({ aaaaaa: "Jane" });
    expect(parseAnswers(fields, {})).toMatch(/Fill in "Name"/);
  });
});

describe("planInitials and awardCents", () => {
  it("makes the placeholder from the first two words", () => {
    expect(planInitials("School Grant")).toBe("SG");
    expect(planInitials("women in tech")).toBe("WI");
    expect(planInitials("Healthcare")).toBe("HE");
    expect(planInitials("  Écoles & Lycées ")).toBe("EL");
    expect(planInitials("!!!")).toBe("GP");
  });
  it("reads award amounts", () => {
    expect(awardCents(1)).toBe(100);
    expect(awardCents(10_000_000)).toBe(1_000_000_000);
    expect(awardCents(0.99)).toBeNull();
    expect(awardCents(Number.NaN)).toBeNull();
  });
});

describe("award ranges", () => {
  it("a plan is fixed unless it asks for a range; a range needs a maximum above the minimum", () => {
    expect(ok({ name: "Ok", amount: 500 })).toMatchObject({ amountMode: "fixed", amountCents: 50000, maxAmountCents: null });
    expect(ok({ name: "Ok", amount: 500, maxAmount: 900 })).toMatchObject({ amountMode: "fixed", maxAmountCents: null });
    expect(ok({ name: "Ok", amountMode: "range", amount: 1000, maxAmount: 10000 })).toMatchObject({ amountMode: "range", amountCents: 100000, maxAmountCents: 1000000 });
    expect(parsePlan({ name: "Ok", amountMode: "ladder", amount: 10 })).toMatch(/fixed award or a range/);
    expect(parsePlan({ name: "Ok", amountMode: "range", amount: 1000 })).toMatch(/maximum must be between/);
    expect(parsePlan({ name: "Ok", amountMode: "range", amount: 1000, maxAmount: 1000 })).toMatch(/more than the minimum/);
    expect(parsePlan({ name: "Ok", amountMode: "range", amount: 0.5, maxAmount: 1000 })).toMatch(/minimum must be between/);
    expect(parsePlan({ name: "Ok", amountMode: "range", amount: 10, maxAmount: 10_000_000.01 })).toMatch(/maximum must be between/);
  });
  it("a fixed charge can't be more than the minimum; a percentage always fits", () => {
    expect(parsePlan({ name: "Ok", amountMode: "range", amount: 10, maxAmount: 1000, fee: { mode: "fixed", amount: 20 } })).toMatch(/more than the minimum/);
    expect(ok({ name: "Ok", amountMode: "range", amount: 10, maxAmount: 1000, fee: { mode: "percent", amount: 100 } }).fee).toEqual({ mode: "percent", value: 10000 });
  });
  it("reads the amount an applicant asks for", () => {
    const range = { amountMode: "range" as const, amountCents: 100000, maxAmountCents: 1000000 };
    expect(requestedCents(range, "4000")).toBe(400000);
    expect(requestedCents(range, "$4,000.50")).toBe(400050);
    expect(requestedCents(range, 1000)).toBe(100000);
    expect(requestedCents(range, "10000")).toBe(1000000);
    expect(requestedCents(range, "999.99")).toMatch(/between \$1,000 and \$10,000/);
    expect(requestedCents(range, "10000.01")).toMatch(/must be between/);
    expect(requestedCents(range, "")).toMatch(/Enter the amount/);
    expect(requestedCents(range, undefined)).toMatch(/Enter the amount/);
    expect(requestedCents(range, "4000.123")).toMatch(/two decimals/);
    expect(requestedCents(range, "-4000")).toMatch(/two decimals/);
    expect(requestedCents(range, "1e4")).toMatch(/two decimals/);
    // A fixed plan (or a copy from before ranges) always gets its own award.
    expect(requestedCents({ amountCents: 50000 }, "9")).toBe(50000);
    expect(requestedCents({ amountMode: "fixed", amountCents: 50000, maxAmountCents: null }, undefined)).toBe(50000);
  });
  it("describes the award", () => {
    const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
    expect(awardText({ amountCents: 50000 }, usd)).toBe("$500.00");
    expect(awardText({ amountMode: "range", amountCents: 100000, maxAmountCents: 1000000 }, usd)).toBe("$1000.00 – $10000.00");
  });
});
