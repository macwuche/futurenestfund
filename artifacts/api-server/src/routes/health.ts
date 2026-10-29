import { Router, type IRouter } from "express";
import { HealthCheckResponse, GetAuthConfigResponse } from "@workspace/api-zod";
import { publicAuthConfig } from "../lib/auth";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/** Public: tells the browser whether sign-in is on and how to reach Supabase Auth. */
router.get("/auth/config", (_req, res) => {
  res.json(GetAuthConfigResponse.parse(publicAuthConfig()));
});

export default router;
