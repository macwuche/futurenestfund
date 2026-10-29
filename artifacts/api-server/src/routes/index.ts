import { Router, type IRouter } from "express";
import cookieParser from "cookie-parser";
import healthRouter from "./health";
import authRouter from "./auth";
import workspaceRouter from "./workspace";
import { authenticate, requireAdmin, requireApplicant } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
// Everything after health needs a signed-in caller; each workspace then checks the role.
router.use(cookieParser(), authenticate);
router.use(authRouter);
router.use("/applicant", requireApplicant);
router.use("/admin", requireAdmin);
router.use(workspaceRouter);

export default router;
