import { Router, type IRouter } from "express";
import { GetMeResponse, CreateSessionResponse } from "@workspace/api-zod";
import { SESSION_COOKIE, authMode, verifyAccessToken } from "../lib/auth";

const router: IRouter = Router();

/** Who is signed in; the frontend uses it to pick the applicant or admin workspace. */
router.get("/me", (req, res) => {
  const who = req.identity!;
  res.json(GetMeResponse.parse({ mode: who.mode, email: who.email, name: who.name, role: who.role, profileId: who.profileId }));
});

/** Mirrors the bearer token into an HttpOnly cookie that only authenticates GET requests (images, downloads). */
router.post("/auth/session", async (req, res) => {
  if (authMode === "demo") { res.json(CreateSessionResponse.parse({ expiresAt: null })); return; }
  const token = req.get("authorization")?.slice(7).trim() ?? "";
  const claims = await verifyAccessToken(token); // authenticate already accepted it; this gives the expiry
  const maxAge = claims.exp * 1000 - Date.now();
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: req.secure || process.env.NODE_ENV === "production", sameSite: "strict", path: "/api", maxAge });
  res.json(CreateSessionResponse.parse({ expiresAt: new Date(claims.exp * 1000).toISOString() }));
});

router.delete("/auth/session", (req, res) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: req.secure || process.env.NODE_ENV === "production", sameSite: "strict", path: "/api" });
  res.status(204).end();
});

export default router;
