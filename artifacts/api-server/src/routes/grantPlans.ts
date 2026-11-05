import { Router, type IRouter, type Request } from "express";
import {
  ListIndustriesResponse, SetApplicantIndustryBody, SetApplicantIndustryResponse, ListAdminIndustriesResponse, CreateAdminIndustryBody,
  CreateAdminIndustryResponse, RenameAdminIndustryParams, RenameAdminIndustryBody, RenameAdminIndustryResponse, DeleteAdminIndustryParams,
  DeleteAdminIndustryResponse, ListApplicantGrantPlansResponse, GetApplicantGrantPlanParams, GetApplicantGrantPlanResponse, GetApplicantGrantPlanLogoParams,
  ListAdminGrantPlansResponse, CreateAdminGrantPlanResponse, GetAdminGrantPlanParams, GetAdminGrantPlanResponse, UpdateAdminGrantPlanParams,
  UpdateAdminGrantPlanResponse, DeleteAdminGrantPlanParams, UploadAdminGrantPlanLogoParams, UploadAdminGrantPlanLogoResponse,
  DeleteAdminGrantPlanLogoParams, DeleteAdminGrantPlanLogoResponse, SetAdminGrantPlanLogoUrlParams, SetAdminGrantPlanLogoUrlBody,
  SetAdminGrantPlanLogoUrlResponse,
} from "@workspace/api-zod";
import { createIndustry, deleteIndustry, listAdminIndustries, listIndustries, renameIndustry, setUserIndustry } from "../lib/industries";
import { profileOf } from "../lib/demoWorkspace";
import { currentAdmin, currentUserId } from "../lib/currentUser";
import {
  adminPlan, applicantPlan, clearPlanLogo, createPlan, deletePlan, listAdminPlans, listApplicantPlans, planLogoFile, setPlanLogo,
  setPlanLogoFromUrl, updatePlan,
} from "../lib/grantPlans";
import type { PlanInput } from "../lib/grantPlanRules";
import { receiveFile, sendFile } from "../lib/uploads";

/** Public (no sign-in): the industry list for the sign-up form. Mounted before authentication. */
export const publicIndustriesRouter: IRouter = Router();
publicIndustriesRouter.get("/industries", async (_req, res): Promise<void> => {
  res.json(ListIndustriesResponse.parse(await listIndustries()));
});

/** Phase 11: industries, grant plans and applying to them. */
const router: IRouter = Router();

router.put("/applicant/industry", async (req, res): Promise<void> => {
  const input = SetApplicantIndustryBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose an industry from the list." }); return; }
  const id = currentUserId(req);
  if (!await setUserIndustry(id, input.data.industryId, (await profileOf(id)).name)) { res.status(404).json({ error: "Profile not found." }); return; }
  res.json(SetApplicantIndustryResponse.parse(await profileOf(id)));
});

const nameOf = (req: Request) => CreateAdminIndustryBody.safeParse(req.body);

router.get("/admin/industries", async (_req, res): Promise<void> => {
  res.json(ListAdminIndustriesResponse.parse(await listAdminIndustries()));
});
router.post("/admin/industries", async (req, res): Promise<void> => {
  const input = nameOf(req);
  if (!input.success) { res.status(400).json({ error: "Give the industry a name." }); return; }
  res.status(201).json(CreateAdminIndustryResponse.parse(await createIndustry(input.data.name, currentAdmin(req))));
});
router.patch("/admin/industries/:industryId", async (req, res): Promise<void> => {
  const params = RenameAdminIndustryParams.safeParse(req.params);
  const input = RenameAdminIndustryBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Give the industry a name." }); return; }
  const list = params.success ? await renameIndustry(params.data.industryId, input.data.name, currentAdmin(req)) : undefined;
  if (!list) { res.status(404).json({ error: "Industry not found." }); return; }
  res.json(RenameAdminIndustryResponse.parse(list));
});
router.delete("/admin/industries/:industryId", async (req, res): Promise<void> => {
  const params = DeleteAdminIndustryParams.safeParse(req.params);
  const list = params.success ? await deleteIndustry(params.data.industryId, currentAdmin(req)) : undefined;
  if (!list) { res.status(404).json({ error: "Industry not found." }); return; }
  res.json(DeleteAdminIndustryResponse.parse(list));
});

/* ---------- grant plans ---------- */
/** The rules in grantPlanRules.ts give field-by-field messages, so the body only has to be an object here. */
const planBody = (req: Request): PlanInput | undefined =>
  req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : undefined;
const NOT_FOUND = { error: "Grant plan not found." };

router.get("/applicant/grant-plans", async (req, res): Promise<void> => {
  res.json(ListApplicantGrantPlansResponse.parse(await listApplicantPlans(currentUserId(req))));
});
router.get("/applicant/grant-plans/:planId", async (req, res): Promise<void> => {
  const params = GetApplicantGrantPlanParams.safeParse(req.params);
  const plan = params.success ? await applicantPlan(currentUserId(req), params.data.planId) : undefined;
  if (!plan) { res.status(404).json({ error: "This grant plan isn't open for applications." }); return; }
  res.json(GetApplicantGrantPlanResponse.parse(plan));
});
router.get("/applicant/grant-plans/:planId/logo", async (req, res): Promise<void> => {
  const params = GetApplicantGrantPlanLogoParams.safeParse(req.params);
  await sendFile(req, res, params.success ? await planLogoFile(params.data.planId) : undefined);
});

router.get("/admin/grant-plans", async (_req, res): Promise<void> => {
  res.json(ListAdminGrantPlansResponse.parse(await listAdminPlans()));
});
router.post("/admin/grant-plans", async (req, res): Promise<void> => {
  const body = planBody(req);
  if (!body) { res.status(400).json({ error: "Send the plan's details." }); return; }
  res.status(201).json(CreateAdminGrantPlanResponse.parse(await createPlan(body, currentAdmin(req))));
});
router.get("/admin/grant-plans/:planId", async (req, res): Promise<void> => {
  const params = GetAdminGrantPlanParams.safeParse(req.params);
  const plan = params.success ? await adminPlan(params.data.planId) : undefined;
  if (!plan) { res.status(404).json(NOT_FOUND); return; }
  res.json(GetAdminGrantPlanResponse.parse(plan));
});
router.patch("/admin/grant-plans/:planId", async (req, res): Promise<void> => {
  const params = UpdateAdminGrantPlanParams.safeParse(req.params);
  const body = planBody(req);
  if (!body) { res.status(400).json({ error: "Send the plan's changes." }); return; }
  const plan = params.success ? await updatePlan(params.data.planId, body, currentAdmin(req)) : undefined;
  if (!plan) { res.status(404).json(NOT_FOUND); return; }
  res.json(UpdateAdminGrantPlanResponse.parse(plan));
});
router.delete("/admin/grant-plans/:planId", async (req, res): Promise<void> => {
  const params = DeleteAdminGrantPlanParams.safeParse(req.params);
  if (!params.success || !await deletePlan(params.data.planId, currentAdmin(req))) { res.status(404).json(NOT_FOUND); return; }
  res.status(204).end();
});
router.post("/admin/grant-plans/:planId/logo", receiveFile, async (req, res): Promise<void> => {
  const params = UploadAdminGrantPlanLogoParams.safeParse(req.params);
  if (!params.success || !await setPlanLogo(params.data.planId, req.file, currentAdmin(req))) { res.status(404).json(NOT_FOUND); return; }
  res.json(UploadAdminGrantPlanLogoResponse.parse(await adminPlan(params.data.planId)));
});
router.post("/admin/grant-plans/:planId/logo-url", async (req, res): Promise<void> => {
  const params = SetAdminGrantPlanLogoUrlParams.safeParse(req.params);
  const input = SetAdminGrantPlanLogoUrlBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Enter the image link (up to 2,000 characters)." }); return; }
  if (!params.success || !await setPlanLogoFromUrl(params.data.planId, input.data.url, currentAdmin(req))) { res.status(404).json(NOT_FOUND); return; }
  res.json(SetAdminGrantPlanLogoUrlResponse.parse(await adminPlan(params.data.planId)));
});
router.delete("/admin/grant-plans/:planId/logo", async (req, res): Promise<void> => {
  const params = DeleteAdminGrantPlanLogoParams.safeParse(req.params);
  if (!params.success || !await clearPlanLogo(params.data.planId, currentAdmin(req))) { res.status(404).json(NOT_FOUND); return; }
  res.json(DeleteAdminGrantPlanLogoResponse.parse(await adminPlan(params.data.planId)));
});

export default router;
