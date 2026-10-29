import { randomInt } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { eq } from "drizzle-orm";
import { db, demoProfilesTable } from "@workspace/db";
import { logger } from "./logger";

export type Role = "applicant" | "admin" | "root";

/** Who is calling. `profileId` is set for applicants only (their demo_profiles row). */
export type Identity = { mode: "supabase" | "demo"; authUserId: string | null; email: string; name: string; role: Role; profileId: string | null };

declare global {
  namespace Express {
    interface Request { identity?: Identity }
  }
}

/** GET-only cookie holding the access token, so <img> and download links work; never accepted for changes. */
export const SESSION_COOKIE = "gp_session";

const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
const production = process.env.NODE_ENV === "production";

/**
 * AUTH_MODE=demo keeps the pre-sign-in behaviour (everyone is the demo applicant / demo administrator) and is refused
 * in production. AUTH_MODE=supabase verifies Supabase access tokens. Unset: Supabase, except in development when
 * Supabase isn't configured yet, where it falls back to demo so the preview keeps working.
 */
export const authMode: "supabase" | "demo" =
  process.env.AUTH_MODE === "demo" ? "demo"
  : process.env.AUTH_MODE === "supabase" || production || (supabaseUrl && publishableKey) ? "supabase"
  : "demo";
if (authMode === "demo" && production) {
  throw new Error("AUTH_MODE=demo is not allowed in production.");
}
if (authMode === "supabase" && (!supabaseUrl || !publishableKey)) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set to verify sign-ins (or set AUTH_MODE=demo in development).");
}
if (authMode === "demo") logger.warn("AUTH_MODE=demo: sign-in is off; every request acts as the sample applicant or administrator");

/** What the browser needs to start Supabase Auth; the publishable key is meant to be public. */
export const publicAuthConfig = () =>
  authMode === "supabase" ? { mode: authMode, supabaseUrl: supabaseUrl!, publishableKey: publishableKey! } : { mode: authMode, supabaseUrl: null, publishableKey: null };
const issuer = `${supabaseUrl}/auth/v1`;
// Supabase signs access tokens with asymmetric keys published here; jose caches them and refetches on rotation.
const jwks = authMode === "supabase" ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;

type SupabaseClaims = JWTPayload & {
  email?: string;
  role?: string;
  app_metadata?: { role?: unknown };
  user_metadata?: { name?: unknown; organization?: unknown };
};

class AuthError extends Error {}

/** Verifies a Supabase access token: signature, issuer, audience, expiry, and a signed-in (non-anonymous) user. */
export async function verifyAccessToken(token: string): Promise<SupabaseClaims & { exp: number }> {
  if (!jwks) throw new AuthError("Sign-in is not configured.");
  const { payload } = await jwtVerify<SupabaseClaims>(token, jwks, { issuer, audience: "authenticated", algorithms: ["ES256", "RS256"] });
  if (payload.role !== "authenticated" || !payload.sub || !payload.email || !payload.exp) throw new AuthError("Not a signed-in user.");
  return payload as SupabaseClaims & { exp: number };
}

function bearer(req: Request): string | undefined {
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || undefined;
  // Cookies only authenticate reads: a cross-site form can't trigger a change with them.
  if (req.method === "GET" || req.method === "HEAD") return req.cookies?.[SESSION_COOKIE] || undefined;
  return undefined;
}

const roleOf = (claims: SupabaseClaims): Role => {
  const role = claims.app_metadata?.role; // app_metadata is only writable with the secret key
  return role === "admin" || role === "root" ? role : "applicant";
};
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The applicant's profile, created on their first signed-in request. */
async function applicantProfileId(authUserId: string, email: string, claims: SupabaseClaims): Promise<string> {
  const [existing] = await db.select({ id: demoProfilesTable.id }).from(demoProfilesTable).where(eq(demoProfilesTable.authUserId, authUserId));
  if (existing) return existing.id;
  const id = `usr-${authUserId}`;
  await db.insert(demoProfilesTable).values({
    id,
    authUserId,
    email,
    name: text(claims.user_metadata?.name, 120) || email.split("@")[0],
    organization: text(claims.user_metadata?.organization, 160),
    maskedId: `•••• •••• ${String(randomInt(0, 10000)).padStart(4, "0")}`,
    tier: 1,
    verificationLevel: "Unsubmitted",
    status: "Active",
    permissions: { emailNotifications: true, withdrawalKycRequired: true, depositKycRequired: false },
    joinedAt: new Date().toISOString().slice(0, 10),
  }).onConflictDoNothing();
  // A concurrent first request may have inserted it; read back whichever row won.
  const [row] = await db.select({ id: demoProfilesTable.id }).from(demoProfilesTable).where(eq(demoProfilesTable.authUserId, authUserId));
  if (!row) throw new AuthError("Your profile could not be created. The email may already belong to another profile.");
  return row.id;
}

/** Resolves the caller; 401 when there is no valid sign-in. Runs for every route except health. */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (authMode === "demo") {
    const admin = req.path.startsWith("/admin");
    req.identity = admin
      ? { mode: "demo", authUserId: null, email: "", name: "Demo administrator", role: "admin", profileId: null }
      : { mode: "demo", authUserId: null, email: "jane.cooper@example.com", name: "Jane Cooper", role: "applicant", profileId: "usr-jane" };
    next();
    return;
  }
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: "Please sign in." });
    return;
  }
  try {
    const claims = await verifyAccessToken(token);
    const role = roleOf(claims);
    const email = claims.email!.toLowerCase();
    req.identity = {
      mode: "supabase", authUserId: claims.sub!, email, role,
      name: text(claims.user_metadata?.name, 120) || email,
      profileId: role === "applicant" ? await applicantProfileId(claims.sub!, email, claims) : null,
    };
    next();
  } catch (err) {
    if (err instanceof AuthError || (err as { code?: string }).code?.startsWith("ERR_J")) {
      res.status(401).json({ error: err instanceof AuthError ? err.message : "Your session has expired or is invalid. Please sign in again." });
      return;
    }
    logger.error({ err }, "Authentication failed");
    next(err);
  }
}

/** Only applicants (not administrators) use the applicant workspace. */
export function requireApplicant(req: Request, res: Response, next: NextFunction): void {
  if (req.identity?.role === "applicant" && req.identity.profileId) { next(); return; }
  res.status(403).json({ error: "This area is for applicants." });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.identity?.role === "admin" || req.identity?.role === "root") { next(); return; }
  res.status(403).json({ error: "Administrator access is required." });
}
