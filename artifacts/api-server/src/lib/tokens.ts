import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export type SupabaseClaims = JWTPayload & {
  email?: string;
  role?: string;
  app_metadata?: { role?: unknown };
  user_metadata?: { name?: unknown; organization?: unknown };
};

/** The token is bad (expired, forged, wrong project, not a signed-in user): the caller gets a 401. */
export class AuthError extends Error {}
/** Supabase couldn't be reached to check a sign-in: a 503, so the browser retries instead of signing the user out. */
export class AuthUnavailable extends Error {}

/**
 * Verifies a Supabase access token against the project's signing keys: signature (asymmetric algorithms only, so a
 * forged HS256 token signed with a public key is refused), issuer, audience, expiry, and a signed-in (non-anonymous) user.
 */
export async function verifySupabaseToken(token: string, keys: JWTVerifyGetKey, issuer: string): Promise<SupabaseClaims & { exp: number; sub: string; email: string }> {
  let payload: SupabaseClaims;
  try {
    ({ payload } = await jwtVerify<SupabaseClaims>(token, keys, { issuer, audience: "authenticated", algorithms: ["ES256", "RS256"] }));
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Fetching Supabase's signing keys failed: that's our outage, not a bad token.
    if (!code || code === "ERR_JWKS_TIMEOUT" || code === "ERR_JWKS_INVALID") throw new AuthUnavailable((err as Error).message);
    throw new AuthError("Your session has expired or is invalid. Please sign in again.");
  }
  if (payload.role !== "authenticated" || !payload.sub || !payload.email || !payload.exp) throw new AuthError("Not a signed-in user.");
  return payload as SupabaseClaims & { exp: number; sub: string; email: string };
}
