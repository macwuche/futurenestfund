import type { Request } from "express";

/**
 * The applicant a request acts for. Until real sign-in exists (plan item P1) every request is the demo applicant;
 * route handlers must go through this helper so swapping in session-based identity is a one-place change.
 */
export function currentUserId(_req: Request): string {
  return "usr-jane";
}

/** The administrator acting on a request; same idea as `currentUserId`, swapped for the signed-in admin in P1. */
export function currentAdmin(_req: Request): string {
  return "Demo administrator";
}
