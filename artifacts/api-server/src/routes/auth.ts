import { Router, type IRouter, type Request, type Response } from "express";
import { GetMeResponse, CreateSessionResponse } from "@workspace/api-zod";
import { ACT_AS_COOKIE, ACT_AS_COOKIE_PATH, SESSION_COOKIE, authMode, verifyAccessToken } from "../lib/auth";

const router: IRouter = Router();

/** Who is signed in; the frontend uses it to pick the applicant or admin workspace. */
router.get("/me", (req, res) => {
  const who = req.identity!;
  res.json(GetMeResponse.parse({ mode: who.mode, email: who.email, name: who.name, role: who.role, profileId: who.profileId, actingAdmin: who.actingAdmin ?? null }));
});

/** Mirrors the bearer token into an HttpOnly cookie that only authenticates GET requests (images, downloads). */
const cookieOptions = (req: Request, path: string) =>
  ({ httpOnly: true, secure: req.secure || process.env.NODE_ENV === "production", sameSite: "strict" as const, path });

/**
 * While signed in as a user, the tab also gets the GET-only act-as cookie. An applicant's own session clears any left
 * over from an administrator on this browser; an administrator's own tab leaves it, so a sign-in-as tab keeps working.
 */
function syncActAsCookie(req: Request, res: Response, maxAge: number | undefined) {
  const who = req.identity!;
  if (who.actingAdmin) res.cookie(ACT_AS_COOKIE, who.profileId!, { ...cookieOptions(req, ACT_AS_COOKIE_PATH), maxAge });
  else if (who.role === "applicant") res.clearCookie(ACT_AS_COOKIE, cookieOptions(req, ACT_AS_COOKIE_PATH));
}

/** Mirrors the bearer token into an HttpOnly cookie that only authenticates GET requests (images, downloads). */
router.post("/auth/session", async (req, res) => {
  if (authMode === "demo") { syncActAsCookie(req, res, undefined); res.json(CreateSessionResponse.parse({ expiresAt: null })); return; }
  const token = req.get("authorization")?.slice(7).trim() ?? "";
  const claims = await verifyAccessToken(token); // authenticate already accepted it; this gives the expiry
  const maxAge = claims.exp * 1000 - Date.now();
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req, "/api"), maxAge });
  syncActAsCookie(req, res, maxAge);
  res.json(CreateSessionResponse.parse({ expiresAt: new Date(claims.exp * 1000).toISOString() }));
});

/** Sign-out clears both cookies; leaving a sign-in-as tab clears only the act-as one, so the administrator stays signed in. */
router.delete("/auth/session", (req, res) => {
  res.clearCookie(ACT_AS_COOKIE, cookieOptions(req, ACT_AS_COOKIE_PATH));
  if (!req.identity!.actingAdmin) res.clearCookie(SESSION_COOKIE, cookieOptions(req, "/api"));
  res.status(204).end();
});

export default router;
