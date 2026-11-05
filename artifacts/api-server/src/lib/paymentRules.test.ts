import { describe, expect, it } from "vitest";
import { amountProblem, describeAmountRule, parseAnswers, parseMethod, sourceAllowed, type MethodField } from "./paymentRules";

describe("payment methods: what an admin can save", () => {
  it("accepts a range method and normalises it", () => {
    const m = parseMethod({ name: "  Bank transfer ", minAmount: 50, maxAmount: 5000, fields: [{ label: "Account number", type: "text", required: true }] }, "Deposit");
    expect(typeof m).toBe("object");
    if (typeof m === "string") return;
    expect(m).toMatchObject({ name: "Bank transfer", amountMode: "range", minCents: 5000, maxCents: 500000, fixedAmountsCents: [], proofMode: "required", enabled: true });
    expect(m.fields[0]).toMatchObject({ label: "Account number", type: "text", required: true });
    expect(m.fields[0]!.id).toMatch(/^[a-z0-9]{10}$/);
  });
  it("needs a sensible name, and min ≤ max", () => {
    expect(parseMethod({ name: "X" }, "Deposit")).toMatch(/name of 2–60/);
    expect(parseMethod({ name: "Card", minAmount: 100, maxAmount: 50 }, "Deposit")).toBe("The minimum can't be higher than the maximum.");
    expect(parseMethod({ name: "Card", minAmount: 0 }, "Deposit")).toMatch(/minimum must be between/);
    expect(parseMethod({ name: "Card", maxAmount: 10.001 }, "Deposit")).toMatch(/maximum must be between/);
  });
  it("takes several fixed amounts, sorted, without duplicates", () => {
    const m = parseMethod({ name: "Voucher", amountMode: "fixed", fixedAmounts: [500, 100, 250] }, "Deposit");
    expect(typeof m !== "string" && m.fixedAmountsCents).toEqual([10000, 25000, 50000]);
    expect(parseMethod({ name: "Voucher", amountMode: "fixed", fixedAmounts: [] }, "Deposit")).toBe("Add at least one fixed amount.");
    expect(parseMethod({ name: "Voucher", amountMode: "fixed", fixedAmounts: [100, 100] }, "Deposit")).toBe("$100.00 is listed twice.");
    expect(parseMethod({ name: "Voucher", amountMode: "fixed", fixedAmounts: Array.from({ length: 11 }, (_, i) => i + 1) }, "Deposit")).toMatch(/at most 10/);
  });
  it("checks every field: label, type, unique labels, dropdown options", () => {
    expect(parseMethod({ name: "Crypto", fields: [{ label: "", type: "text" }] }, "Deposit")).toMatch(/Field 1: give it a label/);
    expect(parseMethod({ name: "Crypto", fields: [{ label: "Wallet", type: "script" }] }, "Deposit")).toBe('Field "Wallet": choose a type.');
    expect(parseMethod({ name: "Crypto", fields: [{ label: "Wallet", type: "text" }, { label: "wallet", type: "text" }] }, "Deposit")).toMatch(/Two fields are called/);
    expect(parseMethod({ name: "Crypto", fields: [{ label: "Network", type: "select", options: [" ", ""] }] }, "Deposit")).toMatch(/at least one option/);
    const ok = parseMethod({ name: "Crypto", fields: [{ id: "abcdef1234", label: "Network", type: "select", options: ["TRC20", "ERC20", "TRC20"], required: false }] }, "Deposit");
    expect(typeof ok !== "string" && ok.fields[0]).toEqual({ id: "abcdef1234", label: "Network", type: "select", required: false, options: ["TRC20", "ERC20"] });
  });
  it("keeps proof settings for deposits only", () => {
    expect(typeof parseMethod({ name: "Bank", proofMode: "optional" }, "Deposit") !== "string" && (parseMethod({ name: "Bank", proofMode: "optional" }, "Deposit") as { proofMode: string }).proofMode).toBe("optional");
    expect((parseMethod({ name: "Bank", proofMode: "required" }, "Withdrawal") as { proofMode: string }).proofMode).toBe("off");
    expect(parseMethod({ name: "Bank", proofMode: "maybe" }, "Deposit")).toMatch(/required, optional or off/);
  });
});

describe("payment methods: what a request must satisfy", () => {
  const range = { amountMode: "range" as const, minCents: 5000, maxCents: 500000, fixedAmountsCents: [] };
  const fixed = { amountMode: "fixed" as const, minCents: null, maxCents: null, fixedAmountsCents: [10000, 25000] };
  it("describes the amount rule", () => {
    expect(describeAmountRule(range)).toBe("$50.00 – $5,000.00");
    expect(describeAmountRule(fixed)).toBe("Fixed: $100.00 / $250.00");
    expect(describeAmountRule({ ...range, maxCents: null })).toBe("From $50.00");
    expect(describeAmountRule({ ...range, minCents: null, maxCents: null })).toBe("Any amount");
  });
  it("checks the amount against the method", () => {
    expect(amountProblem(range, 5000)).toBeNull();
    expect(amountProblem(range, 4999)).toBe("The minimum for this method is $50.00.");
    expect(amountProblem(range, 500001)).toBe("The maximum for this method is $5,000.00.");
    expect(amountProblem(fixed, 25000)).toBeNull();
    expect(amountProblem(fixed, 20000)).toBe("Choose one of the amounts for this method: $100.00, $250.00.");
  });
  const fields: MethodField[] = [
    { id: "wallet", label: "Wallet address", type: "text", required: true },
    { id: "net", label: "Network", type: "select", required: true, options: ["TRC20", "ERC20"] },
    { id: "mail", label: "Email", type: "email", required: false },
    { id: "when", label: "Paid on", type: "date", required: false },
  ];
  it("checks answers and keeps only the method's fields", () => {
    expect(parseAnswers(fields, { wallet: " T9xyz ", net: "TRC20", junk: "x" })).toEqual({ wallet: "T9xyz", net: "TRC20" });
    expect(parseAnswers(fields, { net: "TRC20" })).toBe('Fill in "Wallet address".');
    expect(parseAnswers(fields, { wallet: "a", net: "BTC" })).toBe('Choose one of the options for "Network".');
    expect(parseAnswers(fields, { wallet: "a", net: "ERC20", mail: "nope" })).toBe('"Email" must be an email address.');
    expect(parseAnswers(fields, { wallet: "a", net: "ERC20", when: "2026-13-45" })).toBe('"Paid on" must be a date.');
    expect(parseAnswers(fields, { wallet: "x".repeat(501), net: "ERC20" })).toMatch(/at most 500/);
    expect(parseAnswers(fields, "not an object")).toBe('Fill in "Wallet address".');
  });
  it("knows which balances a user may withdraw from", () => {
    expect(sourceAllowed("grant", "grant")).toBe(true);
    expect(sourceAllowed("grant", "deposit")).toBe(false);
    expect(sourceAllowed("both", "deposit")).toBe(true);
  });
});

describe("payment methods: fees (9.3)", () => {
  it("keeps a fixed or percentage fee, defaulting to none", () => {
    const a = parseMethod({ name: "Bank", fee: { mode: "percent", amount: 1.5 } }, "Withdrawal");
    expect(typeof a !== "string" && a.fee).toEqual({ mode: "percent", value: 150 });
    const b = parseMethod({ name: "Bank" }, "Deposit");
    expect(typeof b !== "string" && b.fee).toEqual({ mode: "fixed", value: 0 });
  });
  it("refuses a negative fee", () => {
    expect(parseMethod({ name: "Bank", fee: { mode: "fixed", amount: -2 } }, "Withdrawal")).toMatch(/negative/);
  });
});
