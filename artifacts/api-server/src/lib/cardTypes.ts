/**
 * Card types (Step 9.3): the fixed list of cards an administrator can sell, switched on or off in Admin Settings → Cards,
 * each with a price and a fee for its virtual and its physical card. Stored in `demo_settings.card_types` (jsonb).
 * No card network or credit line is connected: a "Credit" card spends only what was topped up, like every other card.
 */
import { eq } from "drizzle-orm";
import { db, demoAuditTable, demoSettingsTable } from "@workspace/db";
import { DemoInputError } from "./demoWorkspace";
import { describeFee, feeCents, feeOut, parseFee, storedFee, type FeeRule } from "./fees";

export const CARD_TYPES = [
  { key: "visa-debit", name: "Visa Debit", network: "Visa" },
  { key: "visa-credit", name: "Visa Credit", network: "Visa" },
  { key: "mastercard-debit", name: "Mastercard Debit", network: "Mastercard" },
  { key: "mastercard-credit", name: "Mastercard Credit", network: "Mastercard" },
  { key: "amex-platinum", name: "Amex Platinum", network: "Amex" },
] as const;
export type CardTypeKey = (typeof CARD_TYPES)[number]["key"];
export type CardNetwork = (typeof CARD_TYPES)[number]["network"];
export type CardKind = "Virtual" | "Physical";

/** One kind of one type: no price = not sold to applicants. */
export type KindPrice = { priceCents: number | null; fee: FeeRule };
export type CardTypeSetting = { enabled: boolean; virtual: KindPrice; physical: KindPrice };
export type CardTypeSettings = Record<CardTypeKey, CardTypeSetting>;

const MAX_PRICE_CENTS = 100_000_000;
const NOT_SOLD: KindPrice = { priceCents: null, fee: { mode: "fixed", value: 0 } };

export const isCardType = (k: unknown): k is CardTypeKey => CARD_TYPES.some(t => t.key === k);
export const cardTypeInfo = (k: CardTypeKey) => CARD_TYPES.find(t => t.key === k)!;
/** Cards issued before types existed were Visa or Mastercard: they read as the debit card of that network. */
export const typeOfCard = (c: { type?: unknown; network?: unknown }): CardTypeKey =>
  isCardType(c.type) ? c.type : c.network === "Mastercard" ? "mastercard-debit" : c.network === "Amex" ? "amex-platinum" : "visa-debit";

function storedKind(raw: unknown): KindPrice {
  const r = (raw ?? {}) as { priceCents?: unknown; fee?: { mode?: unknown; value?: unknown } };
  const p = r.priceCents;
  const priceCents = typeof p === "number" && Number.isSafeInteger(p) && p >= 0 && p <= MAX_PRICE_CENTS ? p : null;
  return { priceCents, fee: storedFee(r.fee?.mode, r.fee?.value) };
}

/** The stored settings, with every type present (missing ones are off and not priced). */
export function cardTypeSettings(raw: unknown): CardTypeSettings {
  const all = (raw && typeof raw === "object" ? raw : {}) as Record<string, { enabled?: unknown; virtual?: unknown; physical?: unknown }>;
  return Object.fromEntries(CARD_TYPES.map(t => {
    const s = all[t.key];
    return [t.key, { enabled: s?.enabled === true, virtual: s ? storedKind(s.virtual) : NOT_SOLD, physical: s ? storedKind(s.physical) : NOT_SOLD }];
  })) as CardTypeSettings;
}

/** Price, fee and total for one kind; null when that kind has no price. */
export function priceOf(p: KindPrice) {
  if (p.priceCents === null) return null;
  const fee = feeCents(p.fee, p.priceCents);
  return { priceCents: p.priceCents, feeCents: fee, totalCents: p.priceCents + fee };
}

const kindOut = (p: KindPrice) => {
  const q = priceOf(p);
  return { price: p.priceCents === null ? null : p.priceCents / 100, fee: feeOut(p.fee), feeText: describeFee(p.fee, p.priceCents ?? undefined), total: q ? q.totalCents / 100 : null };
};

export async function loadCardTypes(tx: Pick<typeof db, "select"> = db) {
  const [s] = await tx.select({ cardTypes: demoSettingsTable.cardTypes }).from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  return cardTypeSettings(s?.cardTypes);
}

/** Admin view: every type, on or off. */
export async function adminCardTypes() {
  const s = await loadCardTypes();
  return CARD_TYPES.map(t => ({ key: t.key, name: t.name, network: t.network, enabled: s[t.key].enabled, virtual: kindOut(s[t.key].virtual), physical: kindOut(s[t.key].physical) }));
}

/** Applicant view: enabled types, and only the kinds that have a price. */
export async function applicantCardTypes() {
  const s = await loadCardTypes();
  return CARD_TYPES.filter(t => s[t.key].enabled && (s[t.key].virtual.priceCents !== null || s[t.key].physical.priceCents !== null)).map(t => ({
    key: t.key, name: t.name, network: t.network,
    ...(s[t.key].virtual.priceCents !== null ? { virtual: kindOut(s[t.key].virtual) } : {}),
    ...(s[t.key].physical.priceCents !== null ? { physical: kindOut(s[t.key].physical) } : {}),
  }));
}

function parsePrice(v: unknown, what: string): number | null | string {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return `${what}: the price must be a number.`;
  if (v < 0) return `${what}: the price can't be negative.`;
  const c = Math.round(v * 100);
  if (Math.abs(v * 100 - c) > 0.00001) return `${what}: the price can have at most two decimals.`;
  if (c > MAX_PRICE_CENTS) return `${what}: the price can't be more than $1,000,000.`;
  return c;
}

/** Check what the admin sent ({ types: [{ key, enabled, virtual: { price, fee }, physical: { price, fee } }] }) and normalise it. */
export function parseCardTypes(input: unknown, current: CardTypeSettings): CardTypeSettings | string {
  const list = (input as { types?: unknown } | null)?.types;
  if (!Array.isArray(list)) return "The card types couldn't be read.";
  const next = structuredClone(current);
  const seen = new Set<string>();
  for (const raw of list) {
    const t = (raw ?? {}) as { key?: unknown; enabled?: unknown; virtual?: unknown; physical?: unknown };
    if (!isCardType(t.key)) return "Unknown card type.";
    if (seen.has(t.key)) return `${cardTypeInfo(t.key).name} is listed twice.`;
    seen.add(t.key);
    const name = cardTypeInfo(t.key).name;
    const entry: CardTypeSetting = { enabled: t.enabled === true, virtual: NOT_SOLD, physical: NOT_SOLD };
    for (const kind of ["virtual", "physical"] as const) {
      const k = (t[kind] ?? {}) as { price?: unknown; fee?: unknown };
      const what = `${name} ${kind}`;
      const price = parsePrice(k.price, what);
      if (typeof price === "string") return price;
      const fee = parseFee(k.fee, `${what}: the fee`);
      if (typeof fee === "string") return fee;
      entry[kind] = { priceCents: price, fee };
    }
    if (entry.enabled && entry.virtual.priceCents === null && entry.physical.priceCents === null) {
      return `${name} is on but has no price. Give its virtual or physical card a price (0 for free), or switch it off.`;
    }
    next[t.key] = entry;
  }
  return next;
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const describeKind = (p: KindPrice) => (p.priceCents === null ? "not sold" : `${usd(p.priceCents)}${p.fee.value ? ` + ${describeFee(p.fee).replace(/^Fee /, "fee ")}` : ""}`);

export async function changeCardTypes(input: unknown, actor: string) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    const current = cardTypeSettings(row?.cardTypes);
    const next = parseCardTypes(input, current);
    if (typeof next === "string") throw new DemoInputError(next);
    const changes = CARD_TYPES.filter(t => JSON.stringify(next[t.key]) !== JSON.stringify(current[t.key])).map(t => {
      const s = next[t.key];
      return `${t.name} ${s.enabled ? "on" : "off"} (virtual ${describeKind(s.virtual)}, physical ${describeKind(s.physical)})`;
    });
    if (changes.length) {
      await tx.update(demoSettingsTable).set({ cardTypes: next }).where(eq(demoSettingsTable.id, "platform"));
      await tx.insert(demoAuditTable).values({ actor, action: `Card types updated: ${changes.join("; ")}` });
    }
    return true;
  }).then(() => adminCardTypes());
}
