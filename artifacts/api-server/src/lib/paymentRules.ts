/**
 * Pure rules for payment methods (Phase 10): what an administrator may save as a method, and what an applicant's
 * request must satisfy for that method. No database access here, so it's unit-tested directly.
 */
import { randomBytes } from "node:crypto";
import { parseFee, type FeeRule } from "./fees";

export const FIELD_TYPES = ["text", "textarea", "number", "email", "phone", "date", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export type MethodField = { id: string; label: string; type: FieldType; required: boolean; placeholder?: string; help?: string; options?: string[] };
export type AmountMode = "range" | "fixed";
export type ProofMode = "required" | "optional" | "off";
export type MethodKind = "Deposit" | "Withdrawal";

/** A method as stored (cents), the part these rules need. */
export type MethodRules = {
  kind: MethodKind; amountMode: AmountMode; minCents: number | null; maxCents: number | null;
  fixedAmountsCents: number[]; fields: MethodField[]; proofMode: ProofMode;
  /** Step 9.3: withdrawals: paid from the deposit (main) balance on top of the amount; deposits: taken out of the amount. */
  fee: FeeRule;
};

export const LIMITS = { name: [2, 60], label: 60, placeholder: 80, help: 200, instructions: 1000, fields: 20, options: 20, option: 60, fixed: 10, answer: 500 } as const;
const MAX_CENTS = 100_000_000; // $1,000,000

export const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Dollars to cents: $0.01 to $1,000,000 with at most two decimals; null when it isn't one. */
export function toCents(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const c = Math.round(v * 100);
  if (!Number.isSafeInteger(c) || c < 1 || c > MAX_CENTS || Math.abs(v * 100 - c) > 0.00001) return null;
  return c;
}

/** Control characters out, whitespace trimmed (multi-line text keeps its line breaks). */
const clean = (v: unknown, multiline = false) =>
  typeof v === "string" ? (multiline ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "") : v.replace(/[\u0000-\u001f\u007f]/g, " ")).trim() : "";

export type MethodInput = {
  kind?: unknown; name?: unknown; amountMode?: unknown; minAmount?: unknown; maxAmount?: unknown; fixedAmounts?: unknown;
  fields?: unknown; proofMode?: unknown; instructions?: unknown; enabled?: unknown; fee?: unknown;
};
export type ParsedMethod = MethodRules & { name: string; instructions: string; enabled: boolean };

/**
 * Check a method an administrator wants to save and normalise it, or say what's wrong.
 * Existing field ids are kept (so old answers still line up); new fields get a fresh id.
 */
export function parseMethod(input: MethodInput, kind: MethodKind): ParsedMethod | string {
  const name = clean(input.name);
  if (name.length < LIMITS.name[0] || name.length > LIMITS.name[1]) return `Give the method a name of ${LIMITS.name[0]}–${LIMITS.name[1]} characters.`;

  const amountMode = input.amountMode === "fixed" ? "fixed" : input.amountMode === "range" || input.amountMode === undefined ? "range" : null;
  if (!amountMode) return "Choose a minimum and maximum, or fixed amounts.";
  let minCents: number | null = null; let maxCents: number | null = null; let fixedAmountsCents: number[] = [];
  if (amountMode === "range") {
    if (input.minAmount !== null && input.minAmount !== undefined) {
      minCents = toCents(input.minAmount);
      if (minCents === null) return "The minimum must be between $0.01 and $1,000,000, with at most two decimals.";
    }
    if (input.maxAmount !== null && input.maxAmount !== undefined) {
      maxCents = toCents(input.maxAmount);
      if (maxCents === null) return "The maximum must be between $0.01 and $1,000,000, with at most two decimals.";
    }
    if (minCents !== null && maxCents !== null && minCents > maxCents) return "The minimum can't be higher than the maximum.";
  } else {
    if (!Array.isArray(input.fixedAmounts) || input.fixedAmounts.length < 1) return "Add at least one fixed amount.";
    if (input.fixedAmounts.length > LIMITS.fixed) return `Add at most ${LIMITS.fixed} fixed amounts.`;
    for (const a of input.fixedAmounts) {
      const c = toCents(a);
      if (c === null) return "Each fixed amount must be between $0.01 and $1,000,000, with at most two decimals.";
      if (fixedAmountsCents.includes(c)) return `${usd(c)} is listed twice.`;
      fixedAmountsCents.push(c);
    }
    fixedAmountsCents = fixedAmountsCents.sort((a, b) => a - b);
  }

  const rawFields = input.fields === undefined ? [] : input.fields;
  if (!Array.isArray(rawFields)) return "The fields couldn't be read.";
  if (rawFields.length > LIMITS.fields) return `A method can have at most ${LIMITS.fields} fields.`;
  const fields: MethodField[] = [];
  const labels = new Set<string>(); const ids = new Set<string>();
  for (const [i, raw] of rawFields.entries()) {
    const f = (raw ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const label = clean(f["label"]);
    if (!label || label.length > LIMITS.label) return `Field ${n}: give it a label of 1–${LIMITS.label} characters.`;
    if (labels.has(label.toLowerCase())) return `Two fields are called "${label}". Give each field its own label.`;
    labels.add(label.toLowerCase());
    const type = f["type"];
    if (typeof type !== "string" || !(FIELD_TYPES as readonly string[]).includes(type)) return `Field "${label}": choose a type.`;
    const placeholder = clean(f["placeholder"]); const help = clean(f["help"]);
    if (placeholder.length > LIMITS.placeholder) return `Field "${label}": keep the placeholder under ${LIMITS.placeholder} characters.`;
    if (help.length > LIMITS.help) return `Field "${label}": keep the help text under ${LIMITS.help} characters.`;
    let options: string[] | undefined;
    if (type === "select") {
      const raw = Array.isArray(f["options"]) ? f["options"].map(o => clean(o)).filter(Boolean) : [];
      options = [...new Set(raw)];
      if (options.length < 1) return `Field "${label}": add at least one option to choose from.`;
      if (options.length > LIMITS.options) return `Field "${label}": at most ${LIMITS.options} options.`;
      if (options.some(o => o.length > LIMITS.option)) return `Field "${label}": keep each option under ${LIMITS.option} characters.`;
    }
    let id = typeof f["id"] === "string" && /^[a-z0-9]{6,16}$/.test(f["id"]) ? f["id"] : "";
    if (!id || ids.has(id)) id = randomBytes(5).toString("hex");
    ids.add(id);
    fields.push({ id, label, type: type as FieldType, required: f["required"] !== false, ...(placeholder ? { placeholder } : {}), ...(help ? { help } : {}), ...(options ? { options } : {}) });
  }

  let proofMode: ProofMode = "off";
  if (kind === "Deposit") {
    const p = input.proofMode ?? "required";
    if (p !== "required" && p !== "optional" && p !== "off") return "Choose whether payment proof is required, optional or off.";
    proofMode = p;
  }
  const instructions = clean(input.instructions, true);
  if (instructions.length > LIMITS.instructions) return `Keep the instructions under ${LIMITS.instructions} characters.`;
  const fee = parseFee(input.fee);
  if (typeof fee === "string") return fee;
  return { kind, name, amountMode, minCents, maxCents, fixedAmountsCents, fields, proofMode, instructions, enabled: input.enabled !== false, fee };
}

/** "$50.00 – $5,000.00", "From $50.00", "Fixed: $100.00 / $250.00", "Any amount". */
export function describeAmountRule(m: Pick<MethodRules, "amountMode" | "minCents" | "maxCents" | "fixedAmountsCents">) {
  if (m.amountMode === "fixed") return `Fixed: ${m.fixedAmountsCents.map(usd).join(" / ")}`;
  if (m.minCents !== null && m.maxCents !== null) return `${usd(m.minCents)} – ${usd(m.maxCents)}`;
  if (m.minCents !== null) return `From ${usd(m.minCents)}`;
  if (m.maxCents !== null) return `Up to ${usd(m.maxCents)}`;
  return "Any amount";
}

/** Why `cents` doesn't fit the method's amount rule; null when it does. */
export function amountProblem(m: Pick<MethodRules, "amountMode" | "minCents" | "maxCents" | "fixedAmountsCents">, cents: number): string | null {
  if (m.amountMode === "fixed") {
    return m.fixedAmountsCents.includes(cents) ? null : `Choose one of the amounts for this method: ${m.fixedAmountsCents.map(usd).join(", ")}.`;
  }
  if (m.minCents !== null && cents < m.minCents) return `The minimum for this method is ${usd(m.minCents)}.`;
  if (m.maxCents !== null && cents > m.maxCents) return `The maximum for this method is ${usd(m.maxCents)}.`;
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()./-]{5,30}$/;

/**
 * Check the applicant's answers against the method's fields and keep only those (by field id).
 * Unknown keys are dropped; empty optional fields are left out.
 */
export function parseAnswers(fields: MethodField[], raw: unknown): Record<string, string> | string {
  const values = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const f of fields) {
    const given = values[f.id];
    const v = typeof given === "number" ? String(given) : clean(given, f.type === "textarea");
    if (!v) {
      if (f.required) return `Fill in "${f.label}".`;
      continue;
    }
    if (v.length > LIMITS.answer) return `"${f.label}" can be at most ${LIMITS.answer} characters.`;
    switch (f.type) {
      case "number": if (!/^-?\d+(\.\d+)?$/.test(v)) return `"${f.label}" must be a number.`; break;
      case "email": if (!EMAIL.test(v)) return `"${f.label}" must be an email address.`; break;
      case "phone": if (!PHONE.test(v)) return `"${f.label}" must be a phone number.`; break;
      case "date": if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return `"${f.label}" must be a date.`; break;
      case "select": if (!f.options?.includes(v)) return `Choose one of the options for "${f.label}".`; break;
    }
    out[f.id] = v;
  }
  return out;
}

export type WithdrawalSources = "grant" | "deposit" | "both";
export type BalanceSource = "grant" | "deposit";
export const sourceAllowed = (allowed: string, source: BalanceSource) => allowed === "both" || allowed === source;
export const SOURCE_LABEL: Record<BalanceSource, string> = { grant: "grant balance", deposit: "account balance" };
export const SOURCES_LABEL: Record<WithdrawalSources, string> = { grant: "grant balance only", deposit: "account balance only", both: "grant and account balances" };
