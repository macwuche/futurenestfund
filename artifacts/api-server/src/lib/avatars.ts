import { eq } from "drizzle-orm";
import { db, demoProfilesTable, demoAuditTable } from "@workspace/db";
import { removeFile, storeUpload } from "./uploads";

/** Replace the profile photo; the previous file is deleted once the new one is committed. */
export async function setAvatar(profileId: string, file: Express.Multer.File | undefined) {
  const previous = await storeUpload(profileId, "avatar", file, async (stored, tx) => {
    const [p] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId)).for("update");
    if (!p) throw new Error("Profile missing");
    await tx.update(demoProfilesTable).set({ avatarFileId: stored.id }).where(eq(demoProfilesTable.id, profileId));
    await tx.insert(demoAuditTable).values({ profileId, actor: p.name, action: "Profile photo updated" });
    return p.avatarFileId;
  });
  if (previous) await removeFile(previous);
}

export async function clearAvatar(profileId: string) {
  const previous = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId)).for("update");
    if (!p?.avatarFileId) return null;
    await tx.update(demoProfilesTable).set({ avatarFileId: null }).where(eq(demoProfilesTable.id, profileId));
    await tx.insert(demoAuditTable).values({ profileId, actor: p.name, action: "Profile photo removed" });
    return p.avatarFileId;
  });
  if (previous) await removeFile(previous);
}
