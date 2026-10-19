import { and, desc, eq, sql } from "drizzle-orm";
import { db, demoNotificationsTable } from "@workspace/db";

type Tx = Pick<typeof db, "insert">;

/** Queue an in-app notification for a user (inside the caller's transaction when given). */
export async function notifyUser(profileId: string, message: string, link?: string, tx: Tx = db) {
  await tx.insert(demoNotificationsTable).values({ profileId, message, link: link ?? null });
}

export async function listNotifications(profileId: string) {
  const rows = await db.select().from(demoNotificationsTable).where(eq(demoNotificationsTable.profileId, profileId))
    .orderBy(desc(demoNotificationsTable.createdAt)).limit(20);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(demoNotificationsTable)
    .where(and(eq(demoNotificationsTable.profileId, profileId), eq(demoNotificationsTable.read, false)));
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
