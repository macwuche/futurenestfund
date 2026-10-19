import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, demoKycDocumentsTable, demoFilesTable, demoProfilesTable, demoAuditTable } from "@workspace/db";
import { fileUrl, storeUpload } from "./uploads";
import { notifyUser } from "./notifications";

export const KYC_KINDS = ["Government ID", "Proof of address"] as const;
export type KycKind = (typeof KYC_KINDS)[number];

/** Current (non-replaced) documents for some profiles, newest first per kind, shaped for the API. */
export async function currentKycDocuments(profileIds: string[], scope: "applicant" | "admin") {
  if (!profileIds.length) return [];
  const rows = await db.select({ doc: demoKycDocumentsTable, mimeType: demoFilesTable.mimeType }).from(demoKycDocumentsTable)
    .leftJoin(demoFilesTable, eq(demoFilesTable.id, demoKycDocumentsTable.fileId))
    .where(and(inArray(demoKycDocumentsTable.profileId, profileIds), eq(demoKycDocumentsTable.superseded, false)))
    .orderBy(asc(demoKycDocumentsTable.kind));
  return rows.map(({ doc, mimeType }) => ({
    profileId: doc.profileId,
    id: doc.id, name: doc.name, kind: doc.kind as KycKind, status: doc.status as "Pending" | "Verified" | "Rejected",
    sample: !doc.fileId,
    ...(doc.sampleConfidence != null && !doc.fileId ? { confidence: doc.sampleConfidence } : {}),
    ...(doc.fileId ? { url: fileUrl(scope, doc.fileId), mimeType: mimeType ?? undefined } : {}),
    submittedAt: doc.createdAt.toISOString(),
  }));
}

const strip = <T extends { profileId: string }>({ profileId: _p, ...rest }: T) => rest;

export async function applicantKyc(profileId: string) {
  const [p] = await db.select({ level: demoProfilesTable.verificationLevel }).from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId));
  return { verificationLevel: p?.level ?? "Unsubmitted", documents: (await currentKycDocuments([profileId], "applicant")).map(strip) };
}

/**
 * Store a new identity document, replacing the current one of that kind (the old row is kept as superseded).
 * An unverified or rejected user moves to Pending once both kinds are on file; a verified user keeps
 * their status while the replacement is reviewed.
 */
export async function uploadKycDocument(profileId: string, kind: KycKind, file: Express.Multer.File | undefined) {
  await storeUpload(profileId, "kyc", file, async (stored, tx) => {
    const [profile] = await tx.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, profileId)).for("update");
    if (!profile) throw new Error("Profile missing");
    await tx.update(demoKycDocumentsTable).set({ superseded: true })
      .where(and(eq(demoKycDocumentsTable.profileId, profileId), eq(demoKycDocumentsTable.kind, kind), eq(demoKycDocumentsTable.superseded, false)));
    await tx.insert(demoKycDocumentsTable).values({ id: `kyc-${randomUUID().slice(0, 8)}`, profileId, kind, name: stored.originalName, fileId: stored.id });
    const current = await tx.select({ kind: demoKycDocumentsTable.kind, status: demoKycDocumentsTable.status }).from(demoKycDocumentsTable)
      .where(and(eq(demoKycDocumentsTable.profileId, profileId), eq(demoKycDocumentsTable.superseded, false)));
    const complete = KYC_KINDS.every(k => current.some(c => c.kind === k && c.status !== "Rejected"));
    const toPending = complete && (profile.verificationLevel === "Unsubmitted" || profile.verificationLevel === "Rejected");
    if (toPending) await tx.update(demoProfilesTable).set({ verificationLevel: "Pending" }).where(eq(demoProfilesTable.id, profileId));
    await tx.insert(demoAuditTable).values({ profileId, actor: profile.name, action: `KYC ${kind} uploaded (${stored.originalName})` });
    await notifyUser(profileId, toPending ? "Your identity documents were submitted for review" : `${kind} uploaded and queued for review`, "/settings#verification", tx);
  });
  return applicantKyc(profileId);
}
