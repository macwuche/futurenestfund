import { eq } from "drizzle-orm";
import { db, demoProfilesTable, demoAuditTable, demoAdminProfilesTable } from "@workspace/db";
import { notifyUser } from "./notifications";
import { fileUrl, removeFile, storeUpload } from "./uploads";

class ProfileMissing extends Error {}

/**
 * Replace an applicant's profile photo; the previous file is deleted once the new one is committed.
 * `admin` is the acting administrator when it's set from the user inspector: the audit names them and the user is notified.
 * Returns false when the profile doesn't exist (nothing is stored).
 */
export async function setAvatar(profileId: string, file: Express.Multer.File | undefined, admin?: string) {
  let previous: string | null;
  try {
    previous = await storeUpload(profileId, "avatar", file, async (stored, tx) => {
      const [p] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId)).for("update");
      if (!p) throw new ProfileMissing();
      await tx.update(demoProfilesTable).set({ avatarFileId: stored.id }).where(eq(demoProfilesTable.id, profileId));
      await tx.insert(demoAuditTable).values({ profileId, actor: admin ?? p.name, action: admin ? "Profile photo updated by an administrator" : "Profile photo updated" });
      if (admin) await notifyUser(profileId, "An administrator updated your profile photo.", "/settings", tx);
      return p.avatarFileId;
    });
  } catch (err) {
    if (err instanceof ProfileMissing) return false;
    throw err;
  }
  if (previous) await removeFile(previous);
  return true;
}

/** Remove an applicant's profile photo (by the applicant, or by `admin` from the inspector). Returns false when the profile doesn't exist. */
export async function clearAvatar(profileId: string, admin?: string) {
  const result = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId)).for("update");
    if (!p) return { found: false, previous: null };
    if (!p.avatarFileId) return { found: true, previous: null };
    await tx.update(demoProfilesTable).set({ avatarFileId: null }).where(eq(demoProfilesTable.id, profileId));
    await tx.insert(demoAuditTable).values({ profileId, actor: admin ?? p.name, action: admin ? "Profile photo removed by an administrator" : "Profile photo removed" });
    if (admin) await notifyUser(profileId, "An administrator removed your profile photo.", "/settings", tx);
    return { found: true, previous: p.avatarFileId };
  });
  if (result.previous) await removeFile(result.previous);
  return result.found;
}

type AdminWho = { id: string; email: string; name: string };

/** The administrator's own profile in API shape; admins without a row yet simply have no photo. */
export async function adminAccount(who: AdminWho) {
  const [row] = await db.select().from(demoAdminProfilesTable).where(eq(demoAdminProfilesTable.id, who.id));
  return { name: who.name, email: who.email, ...(row?.avatarFileId ? { avatarUrl: fileUrl("admin", row.avatarFileId) } : {}) };
}

/** Replace the administrator's own photo. Audited as a platform entry (no applicant profile), with the admin as actor. */
export async function setAdminAvatar(who: AdminWho, file: Express.Multer.File | undefined) {
  const previous = await storeUpload(who.id, "avatar", file, async (stored, tx) => {
    await tx.insert(demoAdminProfilesTable).values({ id: who.id, email: who.email }).onConflictDoNothing();
    const [row] = await tx.select().from(demoAdminProfilesTable).where(eq(demoAdminProfilesTable.id, who.id)).for("update");
    await tx.update(demoAdminProfilesTable).set({ avatarFileId: stored.id, email: who.email, updatedAt: new Date() }).where(eq(demoAdminProfilesTable.id, who.id));
    await tx.insert(demoAuditTable).values({ actor: who.email || who.name, action: "Administrator profile photo updated" });
    return row?.avatarFileId ?? null;
  });
  if (previous) await removeFile(previous);
}

export async function clearAdminAvatar(who: AdminWho) {
  const previous = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(demoAdminProfilesTable).where(eq(demoAdminProfilesTable.id, who.id)).for("update");
    if (!row?.avatarFileId) return null;
    await tx.update(demoAdminProfilesTable).set({ avatarFileId: null, updatedAt: new Date() }).where(eq(demoAdminProfilesTable.id, who.id));
    await tx.insert(demoAuditTable).values({ actor: who.email || who.name, action: "Administrator profile photo removed" });
    return row.avatarFileId;
  });
  if (previous) await removeFile(previous);
}
