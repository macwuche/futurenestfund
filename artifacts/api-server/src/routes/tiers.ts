import { Router, type IRouter, type Request } from "express";
import {
  GetApplicantTierResponse, CreateApplicantTierRequestResponse, GetAdminTierSettingsResponse, UpdateAdminTierSettingsResponse,
  ListAdminTierRequestsQueryParams, ListAdminTierRequestsResponse, DecideAdminTierRequestParams, DecideAdminTierRequestBody, DecideAdminTierRequestResponse,
} from "@workspace/api-zod";
import { currentAdmin, currentUserId } from "../lib/currentUser";
import { adminTierSettings, applicantTier, changeTierSettings, decideTierRequest, listTierRequests, submitTierRequest, tierRequestForAdmin } from "../lib/tiers";
import { receiveApplicationForm } from "../lib/uploads";

/** Step 9.4: tiers. Settings and the upgrade queue for admins; "Your tier" and upgrade requests for applicants. */
const router: IRouter = Router();

router.get("/applicant/tier", async (req, res): Promise<void> => {
  const tier = await applicantTier(currentUserId(req));
  if (!tier) { res.status(404).json({ error: "Profile not found." }); return; }
  res.json(GetApplicantTierResponse.parse(tier));
});
/** Multipart, like a grant plan application: answers (JSON), fileFields (JSON list) and files. */
router.post("/applicant/tier/requests", receiveApplicationForm, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const files = Array.isArray(req.files) ? req.files : [];
  res.status(201).json(CreateApplicantTierRequestResponse.parse(await submitTierRequest(currentUserId(req), { answers: body["answers"], fileFields: body["fileFields"], files })));
});

/** The rules in tierRules.ts give field-by-field messages, so the body only has to be an object here. */
const objectBody = (req: Request) => (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : undefined);

router.get("/admin/tiers", async (_req, res): Promise<void> => {
  res.json(GetAdminTierSettingsResponse.parse(await adminTierSettings()));
});
router.put("/admin/tiers", async (req, res): Promise<void> => {
  const body = objectBody(req);
  if (!body) { res.status(400).json({ error: "Send the tier settings." }); return; }
  res.json(UpdateAdminTierSettingsResponse.parse(await changeTierSettings(body, currentAdmin(req))));
});
router.get("/admin/tier-requests", async (req, res): Promise<void> => {
  const q = ListAdminTierRequestsQueryParams.safeParse(req.query);
  res.json(ListAdminTierRequestsResponse.parse(await listTierRequests(q.success ? q.data.status ?? "pending" : "pending")));
});
router.post("/admin/tier-requests/:requestId/decision", async (req, res): Promise<void> => {
  const params = DecideAdminTierRequestParams.safeParse(req.params);
  const input = DecideAdminTierRequestBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Approve or decline, with a reason to decline." }); return; }
  const found = params.success && await decideTierRequest(params.data.requestId, input.data.decision, input.data.note ?? "", currentAdmin(req));
  if (!found) { res.status(404).json({ error: "Upgrade request not found." }); return; }
  res.json(DecideAdminTierRequestResponse.parse(await tierRequestForAdmin(params.data.requestId)));
});

export default router;
