import { and, desc, eq, sql } from "drizzle-orm";
import { db, demoNotificationsTable } from "@workspace/db";
import type { MoneyEmailData, MoneyEmailKind } from "./emailTemplates";

type Tx = Pick<typeof db, "insert">;
export type NotificationEmail = { kind: MoneyEmailKind; data: MoneyEmailData };

/**
 * Queue a notification for a user (inside the caller's transaction when given). `email` picks a dedicated email template.
 * The row is always written, so the email can still go out, but it stays off the bell when an administrator turned the
 * user's in-app notifications off (`permissions.inAppOverride = false`).
 */
export async function notifyUser(profileId: string, message: string, link?: string, tx: Tx = db, email?: NotificationEmail) {
  await tx.insert(demoNotificationsTable).values({
    profileId, message, link: link ?? null, emailKind: email?.kind ?? null, emailData: email?.data ?? null,
    inApp: sql`coalesce((select (p.permissions ->> 'inAppOverride')::boolean from demo_profiles p where p.id = ${profileId}), true)`,
  });
}

/** The short reference applicants and admins quote for a deposit or withdrawal request. */
export const requestReference = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

/** Template values for a deposit / withdrawal request email. */
export function requestEmailData(
  r: { id: string; kind: string; amountCents: number; createdAt: Date; source?: string | null; methodSnapshot?: unknown; feeCents?: number }, reason?: string,
): MoneyEmailData {
  const method = (r.methodSnapshot as { name?: unknown } | null | undefined)?.name;
  return {
    request: r.kind === "Deposit" ? "Deposit" : "Withdrawal", amountCents: r.amountCents, reference: requestReference(r.id),
    date: r.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
    ...(reason ? { reason } : {}),
    ...(typeof method === "string" && method ? { method } : {}),
    ...(r.kind === "Withdrawal" && (r.source === "grant" || r.source === "deposit") ? { source: r.source } : {}),
    ...(r.feeCents ? { feeCents: r.feeCents } : {}),
  };
}

export async function listNotifications(profileId: string) {
  const rows = await db.select().from(demoNotificationsTable).where(and(eq(demoNotificationsTable.profileId, profileId), eq(demoNotificationsTable.inApp, true)))
    .orderBy(desc(demoNotificationsTable.createdAt)).limit(20);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(demoNotificationsTable)
    .where(and(eq(demoNotificationsTable.profileId, profileId), eq(demoNotificationsTable.inApp, true), eq(demoNotificationsTable.read, false)));
  return {
    items: rows.map(r => ({ id: r.id, message: r.message, ...(r.link ? { link: r.link } : {}), read: r.read, createdAt: r.createdAt.toISOString() })),
    unread: n,
  };
}

export async function markAllRead(profileId: string) {
  await db.update(demoNotificationsTable).set({ read: true })
    .where(and(eq(demoNotificationsTable.profileId, profileId), eq(demoNotificationsTable.read, false)));
  return listNotifications(profileId);
}
