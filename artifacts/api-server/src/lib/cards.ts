import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, demoAuditTable, demoProfilesTable } from "@workspace/db";
import { DemoInputError, getUser } from "./demoWorkspace";
import { notifyUser } from "./notifications";

/** A sample card as stored in `demo_profiles.cards`. No card network is connected; numbers are a random last four. */
export type StoredCard = {
  id: string; network: "Visa" | "Mastercard"; kind: "Virtual" | "Physical"; lastFour: string;
  status: "Active" | "Frozen" | "Pending" | "Cancelled"; balance: number; statusReason?: string; issuedAt?: string;
};
export type CardAction = "activate" | "freeze" | "unfreeze" | "cancel";

const label = (c: StoredCard) => `${c.kind.toLowerCase()} ${c.network} card •• ${c.lastFour}`;
export const hasActiveCard = (cards: unknown) => Array.isArray(cards) && (cards as StoredCard[]).some(c => c.status === "Active");

/** Which status each action leads to, from which statuses it is allowed, and how a refusal reads. */
const RULES: Record<CardAction, { from: StoredCard["status"][]; to: StoredCard["status"]; refuse: (c: StoredCard) => string }> = {
  activate: { from: ["Pending"], to: "Active", refuse: c => c.status === "Active" ? "This card is already active." : `A ${c.status.toLowerCase()} card can't be marked as issued.` },
  freeze: { from: ["Active"], to: "Frozen", refuse: c => c.status === "Frozen" ? "This card is already frozen." : `Only an active card can be frozen (this one is ${c.status.toLowerCase()}).` },
  unfreeze: { from: ["Frozen"], to: "Active", refuse: c => `Only a frozen card can be unfrozen (this one is ${c.status.toLowerCase()}).` },
  cancel: { from: ["Active", "Frozen", "Pending"], to: "Cancelled", refuse: () => "This card is already cancelled." },
};

/** Lock the profile row and refuse while the account is frozen; card changes move no money, so the global freeze doesn't apply. */
async function lockCards(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string) {
  const [profile] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, userId)).for("update");
  if (!profile) return undefined;
  if (profile.status === "Frozen") throw new DemoInputError("Unfreeze the account before changing its cards.");
  return { profile, cards: (Array.isArray(profile.cards) ? profile.cards : []) as StoredCard[] };
}

export async function issueCard(userId: string, kind: StoredCard["kind"], network: StoredCard["network"], actor: string) {
  const found = await db.transaction(async tx => {
    const locked = await lockCards(tx, userId);
    if (!locked) return false;
    const { profile, cards } = locked;
    if (cards.some(c => c.kind === kind && c.status !== "Cancelled")) throw new DemoInputError(`This user already has a ${kind.toLowerCase()} card. Cancel it before issuing another.`);
    const card: StoredCard = {
      id: `${profile.id}-${kind.toLowerCase()}-${randomUUID().slice(0, 8)}`, network, kind, lastFour: String(randomInt(0, 10000)).padStart(4, "0"),
      status: kind === "Virtual" ? "Active" : "Pending", balance: 0, issuedAt: new Date().toISOString(),
    };
    await tx.update(demoProfilesTable).set({ cards: [...cards, card] }).where(eq(demoProfilesTable.id, userId));
    await tx.insert(demoAuditTable).values({ profileId: userId, actor, action: `Issued ${label(card)}${kind === "Physical" ? " (pending delivery)" : ""}` });
    await notifyUser(userId, kind === "Virtual"
      ? `A virtual ${network} card ending ${card.lastFour} was issued to you and is ready to use.`
      : `A physical ${network} card ending ${card.lastFour} is being issued. We'll let you know when it's active.`, "/cards", tx);
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
    if (!rule.from.includes(card.status)) throw new DemoInputError(rule.refuse(card));
    const next: StoredCard = { ...card, status: rule.to, ...(action === "cancel" ? { balance: 0 } : {}) };
    if (action === "freeze" || action === "cancel") next.statusReason = why; else delete next.statusReason;
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
