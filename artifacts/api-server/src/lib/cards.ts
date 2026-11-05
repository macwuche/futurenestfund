import { randomInt, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, demoAuditTable, demoLedgerTable, demoProfilesTable, demoSettingsTable } from "@workspace/db";
import { availableCents, DemoInputError, getUser } from "./demoWorkspace";
import { notifyUser } from "./notifications";
import { cardTypeInfo, cardTypeSettings, isCardType, priceOf, typeOfCard, type CardNetwork, type CardTypeKey } from "./cardTypes";

/** A sample card as stored in `demo_profiles.cards`. No card network is connected; numbers are a random last four. */
export type StoredCard = {
  id: string; network: CardNetwork; kind: "Virtual" | "Physical"; lastFour: string;
  /** Step 9.3: the card type (cards from before types existed have none: see typeOfCard) and what the user paid for it. */
  type?: CardTypeKey; pricePaidCents?: number; feePaidCents?: number;
  status: "Active" | "Frozen" | "Pending" | "Cancelled"; balance: number; statusReason?: string; issuedAt?: string;
  /** Who froze a frozen card. Cards frozen before this was recorded count as frozen by an administrator. */
  frozenBy?: "user" | "admin";
  /** When the user said a pending physical card arrived and asked for it to be activated. */
  activationRequestedAt?: string;
  /** The last activation request an administrator declined, and why; cleared when the user asks again or the card is activated. */
  activationDeclinedAt?: string; activationDeclinedReason?: string;
};
export type CardAction = "activate" | "freeze" | "unfreeze" | "cancel";
export type ApplicantCardAction = "freeze" | "unfreeze" | "request-activation";

const frozenByUser = (c: StoredCard) => c.status === "Frozen" && c.frozenBy === "user";

const label = (c: StoredCard) => `${c.kind.toLowerCase()} ${cardTypeInfo(typeOfCard(c)).name} card •• ${c.lastFour}`;
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const hasActiveCard = (cards: unknown) => Array.isArray(cards) && (cards as StoredCard[]).some(c => c.status === "Active");

/** Which status each action leads to, from which statuses it is allowed, and how a refusal reads. */
const RULES: Record<CardAction, { from: StoredCard["status"][]; to: StoredCard["status"]; refuse: (c: StoredCard) => string }> = {
  activate: { from: ["Pending"], to: "Active", refuse: c => c.status === "Active" ? "This card is already active." : `A ${c.status.toLowerCase()} card can't be marked as issued.` },
  // A card the user froze can still be frozen by an administrator, which locks it to them.
  freeze: { from: ["Active", "Frozen"], to: "Frozen", refuse: c => c.status === "Frozen" ? "This card is already frozen." : `Only an active card can be frozen (this one is ${c.status.toLowerCase()}).` },
  unfreeze: { from: ["Frozen"], to: "Active", refuse: c => `Only a frozen card can be unfrozen (this one is ${c.status.toLowerCase()}).` },
  cancel: { from: ["Active", "Frozen", "Pending"], to: "Cancelled", refuse: () => "This card is already cancelled." },
};

/** Lock the profile row and refuse while the account is frozen; card changes move no money, so the global freeze doesn't apply. */
async function lockCards(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string, frozenAccountError = "Unfreeze the account before changing its cards.") {
  const [profile] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, userId)).for("update");
  if (!profile) return undefined;
  if (profile.status === "Frozen" && frozenAccountError) throw new DemoInputError(frozenAccountError);
  return { profile, cards: (Array.isArray(profile.cards) ? profile.cards : []) as StoredCard[] };
}

export type IssueOptions = {
  kind: StoredCard["kind"]; type: CardTypeKey; actor: string;
  /** applicant: buying it themselves (the type must be on sale; always charged). admin: issuing it from the user's profile. */
  by: "applicant" | "admin";
  /** Admin only: issue without charging the price and fee. */
  freeOfCharge?: boolean;
};

/**
 * Issue a card (Step 9.3). The price and fee set in Admin Settings → Cards are paid from the user's deposit (main) balance,
 * in the same transaction as the card, the ledger rows, the audit entry and the notification. Locks settings, then the profile
 * (like approvals), so two purchases at once can't both spend the same money. A kind with no price is free when an admin issues it.
 */
export async function issueCard(userId: string, o: IssueOptions) {
  if (!isCardType(o.type)) throw new DemoInputError("Choose a card type.");
  const info = cardTypeInfo(o.type);
  const found = await db.transaction(async tx => {
    const [settings] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    const setting = cardTypeSettings(settings?.cardTypes)[o.type];
    const kindSetting = o.kind === "Virtual" ? setting.virtual : setting.physical;
    if (o.by === "applicant" && (!setting.enabled || kindSetting.priceCents === null)) {
      throw new DemoInputError(`The ${info.name} ${o.kind.toLowerCase()} card isn't available any more. Choose another card.`);
    }
    const price = o.freeOfCharge && o.by === "admin" ? null : priceOf(kindSetting);
    const charged = price !== null && price.totalCents > 0;
    if (charged && settings?.frozen) throw new DemoInputError("Card purchases are paused while the platform is frozen.");
    const locked = await lockCards(tx, userId, o.by === "applicant" ? "Your account is frozen. Contact support to make changes." : undefined);
    if (!locked) return false;
    const { profile, cards } = locked;
    if (cards.some(c => c.kind === o.kind && c.status !== "Cancelled")) {
      throw new DemoInputError(o.by === "applicant"
        ? `You already have a ${o.kind.toLowerCase()} card. You can hold one ${o.kind.toLowerCase()} card at a time.`
        : `This user already has a ${o.kind.toLowerCase()} card. Cancel it before issuing another.`);
    }
    if (charged) {
      const available = await availableCents(profile, "deposit", tx);
      if (price.totalCents > available) {
        throw new DemoInputError(o.by === "applicant"
          ? `This card costs ${usd(price.totalCents)}${price.feeCents ? ` (${usd(price.priceCents)} + ${usd(price.feeCents)} fee)` : ""}, and your deposit balance has ${usd(available)} available. Add funds first.`
          : `This card costs ${usd(price.totalCents)} and the user's deposit balance has ${usd(available)} available. Tick "Free of charge" to issue it without charging, or ask them to add funds.`);
      }
    }
    const card: StoredCard = {
      id: `${profile.id}-${o.kind.toLowerCase()}-${randomUUID().slice(0, 8)}`, network: info.network, type: o.type, kind: o.kind,
      lastFour: String(randomInt(0, 10000)).padStart(4, "0"), status: o.kind === "Virtual" ? "Active" : "Pending", balance: 0, issuedAt: new Date().toISOString(),
      ...(charged ? { pricePaidCents: price.priceCents, feePaidCents: price.feeCents } : {}),
    };
    await tx.update(demoProfilesTable).set({ cards: [...cards, card], ...(charged ? { depositCents: profile.depositCents - price.totalCents } : {}) }).where(eq(demoProfilesTable.id, userId));
    if (charged) {
      if (price.priceCents > 0) await tx.insert(demoLedgerTable).values({ profileId: userId, kind: "Card purchase", account: "deposit", amountCents: -price.priceCents, reason: `${info.name} ${o.kind.toLowerCase()} card •• ${card.lastFour}`, actor: o.actor });
      if (price.feeCents > 0) await tx.insert(demoLedgerTable).values({ profileId: userId, kind: "Fee", account: "deposit", amountCents: -price.feeCents, reason: `Card fee · ${info.name} ${o.kind.toLowerCase()} card •• ${card.lastFour}`, actor: o.actor });
    }
    const paid = charged ? ` · paid ${usd(price.totalCents)}${price.feeCents ? ` (${usd(price.priceCents)} + fee ${usd(price.feeCents)})` : ""}` : o.by === "admin" && o.freeOfCharge ? " · free of charge" : "";
    await tx.insert(demoAuditTable).values({ profileId: userId, actor: o.actor, action: `${o.by === "applicant" ? "Bought" : "Issued"} ${label(card)}${o.kind === "Physical" ? " (pending delivery)" : ""}${paid}` });
    const cost = charged ? ` ${usd(price.totalCents)} was paid from your deposit balance.` : "";
    await notifyUser(userId, o.kind === "Virtual"
      ? `Your virtual ${info.name} card ending ${card.lastFour} is ready to use.${cost}`
      : `Your physical ${info.name} card ending ${card.lastFour} is being issued. We'll let you know when it's active.${cost}`, "/cards", tx);
    return true;
  });
  return found ? getUser(userId) : undefined;
}

/**
 * Top up a card (Step 9.3): money moves from the deposit (main) balance to the card account, with no fee.
 * The card account is shared by the user's cards; the card must be active. Locks settings then the profile, like approvals.
 */
export async function topUpCard(userId: string, cardId: string, amount: number, actor: string, by: "applicant" | "admin") {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100_000_000 || Math.abs(amount * 100 - cents) > 0.00001) {
    throw new DemoInputError("Enter an amount between $0.01 and $1,000,000 with at most two decimals.");
  }
  const found = await db.transaction(async tx => {
    const [settings] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    if (settings?.frozen) throw new DemoInputError("Top-ups are paused while the platform is frozen.");
    const locked = await lockCards(tx, userId, by === "applicant" ? "Your account is frozen. Contact support to make changes." : "Unfreeze the account before topping up its cards.");
    if (!locked) return false;
    const { profile, cards } = locked;
    const card = cards.find(c => c.id === cardId);
    if (!card) return false;
    if (card.status !== "Active") throw new DemoInputError(`Only an active card can be topped up (this one is ${card.status === "Pending" ? "still being issued" : card.status.toLowerCase()}).`);
    const available = await availableCents(profile, "deposit", tx);
    if (cents > available) {
      throw new DemoInputError(by === "applicant"
        ? `Your deposit balance has ${usd(available)} available${available < profile.depositCents ? " after pending withdrawals" : ""}. Top up less, or add funds first.`
        : `The user's deposit balance has ${usd(available)} available${available < profile.depositCents ? " after pending withdrawals" : ""}, less than ${usd(cents)}.`);
    }
    if (profile.cardCents + cents > 2_000_000_000) throw new DemoInputError("This would exceed the demo account limit.");
    await tx.update(demoProfilesTable).set({ depositCents: profile.depositCents - cents, cardCents: profile.cardCents + cents }).where(eq(demoProfilesTable.id, userId));
    const what = `${cardTypeInfo(typeOfCard(card)).name} card •• ${card.lastFour}`;
    await tx.insert(demoLedgerTable).values([
      { profileId: userId, kind: "Card top-up", account: "deposit", amountCents: -cents, reason: `Top-up of ${what}`, actor },
      { profileId: userId, kind: "Card top-up", account: "card", amountCents: cents, reason: `Top-up of ${what}, from the deposit balance`, actor },
    ]);
    await tx.insert(demoAuditTable).values({ profileId: userId, actor, action: `Card top-up ${usd(cents)} to ${label(card)} from the deposit balance` });
    await notifyUser(userId, `${usd(cents)} was moved from your deposit balance to your ${what}.`, "/cards", tx);
    return true;
  });
  return found ? getUser(userId) : undefined;
}

export async function changeCard(userId: string, cardId: string, action: CardAction, actor: string, reason = "") {
  const why = reason.trim();
  if ((action === "freeze" || action === "cancel") && why.length < 5) throw new DemoInputError(`Give the user a reason of at least 5 characters to ${action} the card.`);
  const found = await db.transaction(async tx => {
    const locked = await lockCards(tx, userId);
    if (!locked) return false;
    const card = locked.cards.find(c => c.id === cardId);
    if (!card) return false;
    const rule = RULES[action];
    if (!rule.from.includes(card.status) || (action === "freeze" && card.status === "Frozen" && !frozenByUser(card))) throw new DemoInputError(rule.refuse(card));
    const next: StoredCard = { ...card, status: rule.to, ...(action === "cancel" ? { balance: 0 } : {}) };
    if (action === "freeze" || action === "cancel") next.statusReason = why; else delete next.statusReason;
    if (action === "freeze") next.frozenBy = "admin"; else delete next.frozenBy;
    if (action !== "freeze") { delete next.activationRequestedAt; delete next.activationDeclinedAt; delete next.activationDeclinedReason; }
    await tx.update(demoProfilesTable).set({ cards: locked.cards.map(c => (c.id === cardId ? next : c)) }).where(eq(demoProfilesTable.id, userId));
    const done = { activate: "marked as issued", freeze: "frozen", unfreeze: "unfrozen", cancel: "cancelled" }[action];
    await tx.insert(demoAuditTable).values({ profileId: userId, actor, action: `Card •• ${card.lastFour} ${done}${why ? ` · ${why}` : ""}` });
    await notifyUser(userId, {
      activate: `Your ${label(card)} has been issued and is now active.`,
      freeze: `Your ${label(card)} was frozen by an administrator: ${why}`,
      unfreeze: `Your ${label(card)} is active again.`,
      cancel: `Your ${label(card)} was cancelled: ${why}`,
    }[action], "/cards", tx);
    return true;
  });
  return found ? getUser(userId) : undefined;
}

/**
 * The user's own controls: freeze and unfreeze a card they froze themselves (an administrator's freeze stays locked to
 * them), and ask for a delivered physical card to be activated. Freezing is allowed even while the account is frozen,
 * since it only makes the card safer. Audited; the user isn't notified of their own action.
 */
export async function changeOwnCard(userId: string, cardId: string, action: ApplicantCardAction, actor: string) {
  return db.transaction(async tx => {
    const locked = await lockCards(tx, userId, action === "freeze" ? "" : "Your account is frozen, so your cards can't be changed until it's unfrozen.");
    if (!locked) throw new Error(`Applicant ${userId} is missing`);
    const card = locked.cards.find(c => c.id === cardId);
    if (!card) return false;
    if (card.status === "Cancelled") throw new DemoInputError("This card is cancelled and can't be changed.");
    let next: StoredCard;
    let audit: string;
    if (action === "freeze") {
      if (card.status === "Frozen") throw new DemoInputError("This card is already frozen.");
      if (card.status !== "Active") throw new DemoInputError("A card that's still being issued can't be frozen.");
      next = { ...card, status: "Frozen", frozenBy: "user" };
      audit = `Card •• ${card.lastFour} frozen by the cardholder`;
    } else if (action === "unfreeze") {
      if (card.status !== "Frozen") throw new DemoInputError("This card isn't frozen.");
      if (!frozenByUser(card)) throw new DemoInputError("An administrator froze this card, so only they can unfreeze it. Contact support if you think this is a mistake.");
      next = { ...card, status: "Active" };
      delete next.frozenBy;
      audit = `Card •• ${card.lastFour} unfrozen by the cardholder`;
    } else {
      if (card.status !== "Pending" || card.kind !== "Physical") throw new DemoInputError("Only a physical card that's still being issued can be activated.");
      if (card.activationRequestedAt) return true;
      next = { ...card, activationRequestedAt: new Date().toISOString() };
      delete next.activationDeclinedAt; delete next.activationDeclinedReason;
      audit = `Activation requested for ${label(card)}`;
    }
    await tx.update(demoProfilesTable).set({ cards: locked.cards.map(c => (c.id === cardId ? next : c)) }).where(eq(demoProfilesTable.id, userId));
    await tx.insert(demoAuditTable).values({ profileId: userId, actor, action: audit });
    return true;
  });
}

/**
 * The admin's card queue: physical cards still being issued (`Pending`). "requested" = the holder says it arrived and asked
 * for activation (oldest request first); "awaiting" = issued, no request yet (oldest issue first). Both tab sizes come back.
 */
export async function listCardRequests(status: "requested" | "awaiting") {
  const rows = (await db.execute<{ id: string; name: string; organization: string; status: string; card: StoredCard }>(sql`
    select p.id, p.name, p.organization, p.status, c as card
    from ${demoProfilesTable} p
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.cards) = 'array' then p.cards else '[]'::jsonb end) c
    where c->>'kind' = 'Physical' and c->>'status' = 'Pending'`)).rows;
  const requested = rows.filter(r => r.card.activationRequestedAt);
  const awaiting = rows.filter(r => !r.card.activationRequestedAt);
  const at = (r: (typeof rows)[number]) => Date.parse((status === "requested" ? r.card.activationRequestedAt : r.card.issuedAt) ?? "") || 0;
  const items = (status === "requested" ? requested : awaiting).sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id)).map(r => ({
    userId: r.id, userName: r.name, organization: r.organization, userStatus: r.status === "Frozen" ? "Frozen" as const : "Active" as const,
    card: (({ pricePaidCents: _p, feePaidCents: _f, ...c }) => ({ ...c, type: typeOfCard(c), typeName: cardTypeInfo(typeOfCard(c)).name, balance: Number(c.balance ?? 0) }))(r.card),
  }));
  return { items, requested: requested.length, awaiting: awaiting.length };
}

/** How many activation requests are waiting (the dashboard KPI and the menu badge). */
export async function countCardRequests() {
  return (await listCardRequests("requested")).requested;
}

/**
 * Decline an activation request (e.g. the card the user has isn't the one that was sent). The card stays `Pending`, the
 * request is cleared so the user can ask again, and they're told why. Allowed while the account is frozen: nothing moves.
 */
export async function declineCardActivation(userId: string, cardId: string, reason: string, actor: string) {
  const why = reason.trim();
  if (why.length < 5) throw new DemoInputError("Give the user a reason of at least 5 characters.");
  const found = await db.transaction(async tx => {
    const locked = await lockCards(tx, userId, "");
    if (!locked) return false;
    const card = locked.cards.find(c => c.id === cardId);
    if (!card) return false;
    if (card.kind !== "Physical" || card.status !== "Pending" || !card.activationRequestedAt) {
      throw new DemoInputError(card.status === "Active" ? "This card is already active." : "This card has no activation request waiting. It may already have been decided.");
    }
    const next: StoredCard = { ...card, activationDeclinedAt: new Date().toISOString(), activationDeclinedReason: why };
    delete next.activationRequestedAt;
    await tx.update(demoProfilesTable).set({ cards: locked.cards.map(c => (c.id === cardId ? next : c)) }).where(eq(demoProfilesTable.id, userId));
    await tx.insert(demoAuditTable).values({ profileId: userId, actor, action: `Activation declined for ${label(card)} · ${why}` });
    await notifyUser(userId, `We couldn't activate your ${label(card)}: ${why}`, "/cards", tx);
    return true;
  });
  return found ? getUser(userId) : undefined;
}
