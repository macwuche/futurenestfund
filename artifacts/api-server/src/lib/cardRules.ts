/**
 * Card payments (Phase 13): the checks on a card a customer saves, with no database or keys involved (tested in
 * cardRules.test.ts). The card itself is stored by paymentCards.ts.
 */

export type CardNetworkKey = "visa" | "mastercard" | "amex" | "verve" | "discover" | "other";
export const NETWORK_NAME: Record<CardNetworkKey, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express", verve: "Verve", discover: "Discover", other: "Card",
};

export const BLOCK_REASONS = ["Lost", "Stolen", "Expired", "Not our card", "Other"] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];
export const REPORT_REASONS = ["Lost", "Stolen", "Expired", "Damaged", "Other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Digits only (spaces and dashes are allowed while typing). */
export const cardDigits = (raw: unknown) => (typeof raw === "string" ? raw.replace(/[\s-]/g, "") : "");

/** The Luhn checksum every payment card number passes. */
export function luhnOk(digits: string) {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** The network, from the number's first digits. */
export function networkOf(digits: string): CardNetworkKey {
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(5061|5078|5079|650002|650027|507865|507866)/.test(digits)) return "verve";
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(digits)) return "mastercard";
  if (/^(6011|65|64[4-9])/.test(digits)) return "discover";
  return "other";
}

const cvvLength = (n: CardNetworkKey) => (n === "amex" ? 4 : 3);

export type CardInput = { holderName?: unknown; number?: unknown; expiry?: unknown; cvv?: unknown };
export type ParsedCard = { holderName: string; number: string; network: CardNetworkKey; lastFour: string; expMonth: number; expYear: number; cvv: string };

/** "MM/YY" or "MM/YYYY" → month and four-digit year, or null. */
export function parseExpiry(raw: unknown): { month: number; year: number } | null {
  const m = typeof raw === "string" ? /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(raw) : null;
  if (!m) return null;
  const month = Number(m[1]);
  const year = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { month, year };
}

/** A card is good through the last day of its expiry month. */
export const isExpired = (expMonth: number, expYear: number, now = new Date()) =>
  expYear < now.getUTCFullYear() || (expYear === now.getUTCFullYear() && expMonth < now.getUTCMonth() + 1);

/** Expires this month or next. */
export const expiresSoon = (expMonth: number, expYear: number, now = new Date()) => {
  if (isExpired(expMonth, expYear, now)) return false;
  const months = (expYear - now.getUTCFullYear()) * 12 + (expMonth - (now.getUTCMonth() + 1));
  return months <= 1;
};

/** Checks a card the way the customer typed it; the parsed card, or the first problem in plain words. */
export function parseCard(input: CardInput, now = new Date()): ParsedCard | string {
  const holderName = typeof input.holderName === "string" ? input.holderName.replace(/\s+/g, " ").trim() : "";
  if (holderName.length < 2) return "Enter the name on the card.";
  if (holderName.length > 80) return "The name on the card can be at most 80 characters.";
  if (/[<>\p{Cc}]/u.test(holderName)) return "The name on the card can't contain < > or control characters.";
  if (/\d/.test(holderName)) return "The name on the card can't contain numbers.";
  const number = cardDigits(input.number);
  if (!number) return "Enter the card number.";
  if (!/^\d{12,19}$/.test(number)) return "A card number has 12 to 19 digits.";
  if (!luhnOk(number)) return "This card number isn't valid. Check it against your card.";
  const network = networkOf(number);
  const exp = parseExpiry(input.expiry);
  if (!exp) return "Enter the expiry date as MM/YY.";
  if (isExpired(exp.month, exp.year, now)) return "This card has expired. Use a card that's still valid.";
  if (exp.year > now.getUTCFullYear() + 20) return "Check the expiry date: it's too far in the future.";
  const cvv = typeof input.cvv === "string" ? input.cvv.trim() : "";
  if (!new RegExp(`^\\d{${cvvLength(network)}}$`).test(cvv)) return `Enter the ${cvvLength(network)}-digit security code (CVV) from the ${network === "amex" ? "front" : "back"} of the card.`;
  return { holderName, number, network, lastFour: number.slice(-4), expMonth: exp.month, expYear: exp.year, cvv };
}

/** "Visa •• 4242" */
export const cardLabel = (c: { network: string; lastFour: string }) => `${NETWORK_NAME[(c.network as CardNetworkKey)] ?? "Card"} •• ${c.lastFour}`;
export const expiryText = (m: number, y: number) => `${String(m).padStart(2, "0")}/${String(y % 100).padStart(2, "0")}`;
/** 4242424242424242 → "4242 4242 4242 4242"; Amex as 4-6-5. */
export function formatNumber(digits: string) {
  if (networkOf(digits) === "amex" && digits.length === 15) return `${digits.slice(0, 4)} ${digits.slice(4, 10)} ${digits.slice(10)}`;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}
