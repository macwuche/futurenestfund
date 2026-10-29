import type { Request } from "express";

/**
 * The applicant a request acts for, set by the `authenticate` middleware (lib/auth.ts).
 * Applicant routes run behind `requireApplicant`, so this is always present there.
 */
export function currentUserId(req: Request): string {
  const id = req.identity?.profileId;
  if (!id) throw new Error("currentUserId called outside an authenticated applicant route");
  return id;
}

/** The administrator acting on a request, as recorded in audit and ledger rows: their email (or the demo name). */
export function currentAdmin(req: Request): string {
  const who = req.identity;
  if (!who || (who.role !== "admin" && who.role !== "root")) throw new Error("currentAdmin called outside an admin route");
  return who.email || who.name;
}
