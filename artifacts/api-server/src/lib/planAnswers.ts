/**
 * How a grant plan application (Phase 11) shows on both sides: the plan as it was when submitted, each answer under its
 * field label (file fields as a link), and the application fee charged on approval.
 */
import type { demoApplicationsTable } from "@workspace/db";
import type { FeeRule } from "./fees";
import type { MethodField } from "./paymentRules";
import { fileUrl, type StoredFile } from "./uploads";

type AppRow = typeof demoApplicationsTable.$inferSelect;

/** What an application keeps of its plan. */
export type PlanSnapshot = {
  planId: string; name: string; description: string; industry: string; amountCents: number; fee: FeeRule; initials: string; fields: MethodField[];
};

export const snapshotOf = (a: Pick<AppRow, "planSnapshot">) => (a.planSnapshot as PlanSnapshot | null) ?? null;
export const answersOf = (a: Pick<AppRow, "answers">) => ((a.answers as Record<string, string> | null) ?? {});

/** The plan's logo: through the plan (it may have changed since; the applicant route serves any plan's logo). */
const logoUrl = (planId: string, logoFileId: string | null | undefined, scope: "admin" | "applicant") =>
  !logoFileId ? undefined : scope === "admin" ? `/api/admin/files/${logoFileId}` : `/api/applicant/grant-plans/${planId}/logo?v=${logoFileId.slice(0, 8)}`;

/**
 * The plan parts of an application's detail. `files` are the application's stored files; `planLogo` the plan's current
 * logo file, if any. Applications from before plans existed get none of these.
 */
export function planParts(a: AppRow, files: StoredFile[], scope: "admin" | "applicant", planLogo?: string | null) {
  const snap = snapshotOf(a);
  if (!snap) return {};
  const answers = answersOf(a);
  const byId = new Map(files.map(f => [f.id, f]));
  const logo = logoUrl(snap.planId, planLogo, scope);
  return {
    plan: { id: snap.planId, name: snap.name, industry: snap.industry, initials: snap.initials, ...(logo ? { logoUrl: logo } : {}) },
    fee: a.feeCents / 100,
    feeCharged: a.status === "Approved",
    answers: snap.fields.map(f => {
      const v = answers[f.id];
      // The field's settings come along, so the applicant can edit the answers after "Changes requested".
      const field = { fieldId: f.id, label: f.label, type: f.type, required: f.required, ...(f.placeholder ? { placeholder: f.placeholder } : {}), ...(f.help ? { help: f.help } : {}), ...(f.options ? { options: f.options } : {}) };
      if (f.type !== "file") return { ...field, value: v ?? "" };
      const file = v ? byId.get(v) : undefined;
      return {
        ...field, value: file?.originalName ?? "",
        ...(file ? { file: { id: file.id, name: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, url: fileUrl(scope, file.id), uploadedAt: file.createdAt.toISOString() } } : {}),
      };
    }),
  };
}

/** Files that are answers to a plan's file fields aren't listed again as loose documents. */
export const looseDocuments = (files: StoredFile[]) => files.filter(f => f.purpose !== "application");
