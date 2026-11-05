import { Router, type IRouter } from "express";
import cookieParser from "cookie-parser";
import healthRouter from "./health";
import authRouter from "./auth";
import workspaceRouter from "./workspace";
import { clientErrorsRouter, monitoringAdminRouter } from "./monitoring";
import emailSettingsRouter from "./emailSettings";
import paymentMethodsRouter from "./paymentMethods";
import grantPlansRouter, { publicIndustriesRouter } from "./grantPlans";
import { authenticate, requireAdmin, requireApplicant } from "../lib/auth";
import { perIp, perUserUploads, perUserWrites } from "../lib/rateLimit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(perIp);
router.use(clientErrorsRouter);
router.use(publicIndustriesRouter);
// Everything below needs a signed-in caller (crash reports above may come from the sign-in page); each workspace then checks the role.
router.use(cookieParser(), authenticate);
router.use((req, res, next) => (req.method === "GET" || req.method === "HEAD" ? next() : perUserWrites(req, res, next)));
router.use((req, res, next) => (req.is("multipart/form-data") ? perUserUploads(req, res, next) : next()));
router.use(authRouter);
router.use("/applicant", requireApplicant);
router.use("/admin", requireAdmin);
router.use(monitoringAdminRouter);
router.use(emailSettingsRouter);
router.use(paymentMethodsRouter);
router.use(grantPlansRouter);
router.use(workspaceRouter);

export default router;
