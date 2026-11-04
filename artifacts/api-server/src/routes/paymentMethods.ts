import { Router, type IRouter, type Request } from "express";
import {
  ListAdminPaymentMethodsQueryParams, ListAdminPaymentMethodsResponse, CreateAdminPaymentMethodResponse, GetAdminPaymentMethodParams, GetAdminPaymentMethodResponse,
  UpdateAdminPaymentMethodParams, UpdateAdminPaymentMethodResponse, DeleteAdminPaymentMethodParams, MoveAdminPaymentMethodParams, MoveAdminPaymentMethodBody,
  MoveAdminPaymentMethodResponse, UploadAdminPaymentMethodLogoParams, UploadAdminPaymentMethodLogoResponse, DeleteAdminPaymentMethodLogoParams,
  DeleteAdminPaymentMethodLogoResponse, SetAdminPaymentMethodLogoUrlParams, SetAdminPaymentMethodLogoUrlBody, SetAdminPaymentMethodLogoUrlResponse,
  ListApplicantPaymentMethodsQueryParams, ListApplicantPaymentMethodsResponse, GetApplicantPaymentMethodLogoParams,
  UpdateUserWithdrawalSourcesParams, UpdateUserWithdrawalSourcesBody, UpdateUserWithdrawalSourcesResponse,
} from "@workspace/api-zod";
import {
  adminMethod, clearMethodLogo, createMethod, deleteMethod, listAdminMethods, listApplicantMethods, methodLogoFile, moveMethod,
  setMethodLogo, setMethodLogoFromUrl, updateMethod,
} from "../lib/paymentMethods";
import { changeUserWithdrawalSources } from "../lib/adminOps";
import { currentAdmin } from "../lib/currentUser";
import { receiveFile, sendFile } from "../lib/uploads";
import type { MethodInput } from "../lib/paymentRules";

/** Payment Gateway (Phase 10): administrators manage methods; applicants list the enabled ones and their logos. */
const router: IRouter = Router();

const kindOf = (req: Request) => ListAdminPaymentMethodsQueryParams.safeParse(req.query);
/** The rules in paymentRules.ts give field-by-field messages, so the body only has to be an object here. */
const bodyOf = (req: Request): (MethodInput & { kind?: unknown; sortOrder?: unknown }) | undefined =>
  req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : undefined;

router.get("/applicant/payment-methods", async (req, res): Promise<void> => {
  const query = ListApplicantPaymentMethodsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Choose Deposit or Withdrawal methods." }); return; }
  res.json(ListApplicantPaymentMethodsResponse.parse(await listApplicantMethods(query.data.kind)));
});
router.get("/applicant/payment-methods/:methodId/logo", async (req, res): Promise<void> => {
  const params = GetApplicantPaymentMethodLogoParams.safeParse(req.params);
  await sendFile(req, res, params.success ? await methodLogoFile(params.data.methodId) : undefined);
});

router.get("/admin/payment-methods", async (req, res): Promise<void> => {
  const query = kindOf(req);
  if (!query.success) { res.status(400).json({ error: "Choose Deposit or Withdrawal methods." }); return; }
  res.json(ListAdminPaymentMethodsResponse.parse(await listAdminMethods(query.data.kind)));
});
router.post("/admin/payment-methods", async (req, res): Promise<void> => {
  const body = bodyOf(req);
  if (!body || (body.kind !== "Deposit" && body.kind !== "Withdrawal")) { res.status(400).json({ error: "Choose whether this is a deposit or a withdrawal method." }); return; }
  res.status(201).json(CreateAdminPaymentMethodResponse.parse(await createMethod(body.kind, body, currentAdmin(req))));
});
router.get("/admin/payment-methods/:methodId", async (req, res): Promise<void> => {
  const params = GetAdminPaymentMethodParams.safeParse(req.params);
  const m = params.success ? await adminMethod(params.data.methodId) : undefined;
  if (!m) { res.status(404).json({ error: "Payment method not found." }); return; }
  res.json(GetAdminPaymentMethodResponse.parse(m));
});
router.patch("/admin/payment-methods/:methodId", async (req, res): Promise<void> => {
  const params = UpdateAdminPaymentMethodParams.safeParse(req.params);
  const body = bodyOf(req);
  if (!body) { res.status(400).json({ error: "Send the method's changes." }); return; }
  const m = params.success ? await updateMethod(params.data.methodId, body, currentAdmin(req)) : undefined;
  if (!m) { res.status(404).json({ error: "Payment method not found." }); return; }
  res.json(UpdateAdminPaymentMethodResponse.parse(m));
});
router.delete("/admin/payment-methods/:methodId", async (req, res): Promise<void> => {
  const params = DeleteAdminPaymentMethodParams.safeParse(req.params);
  if (!params.success || !await deleteMethod(params.data.methodId, currentAdmin(req))) { res.status(404).json({ error: "Payment method not found." }); return; }
  res.status(204).end();
});
router.post("/admin/payment-methods/:methodId/move", async (req, res): Promise<void> => {
  const params = MoveAdminPaymentMethodParams.safeParse(req.params);
  const input = MoveAdminPaymentMethodBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose up or down." }); return; }
  const list = params.success ? await moveMethod(params.data.methodId, input.data.direction, currentAdmin(req)) : undefined;
  if (!list) { res.status(404).json({ error: "Payment method not found." }); return; }
  res.json(MoveAdminPaymentMethodResponse.parse(list));
});
router.post("/admin/payment-methods/:methodId/logo", receiveFile, async (req, res): Promise<void> => {
  const params = UploadAdminPaymentMethodLogoParams.safeParse(req.params);
  if (!params.success || !await setMethodLogo(params.data.methodId, req.file, currentAdmin(req))) { res.status(404).json({ error: "Payment method not found." }); return; }
  res.json(UploadAdminPaymentMethodLogoResponse.parse(await adminMethod(params.data.methodId)));
});
router.post("/admin/payment-methods/:methodId/logo-url", async (req, res): Promise<void> => {
  const params = SetAdminPaymentMethodLogoUrlParams.safeParse(req.params);
  const input = SetAdminPaymentMethodLogoUrlBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Enter the image link (up to 2,000 characters)." }); return; }
  if (!params.success || !await setMethodLogoFromUrl(params.data.methodId, input.data.url, currentAdmin(req))) { res.status(404).json({ error: "Payment method not found." }); return; }
  res.json(SetAdminPaymentMethodLogoUrlResponse.parse(await adminMethod(params.data.methodId)));
});
router.delete("/admin/payment-methods/:methodId/logo", async (req, res): Promise<void> => {
  const params = DeleteAdminPaymentMethodLogoParams.safeParse(req.params);
  if (!params.success || !await clearMethodLogo(params.data.methodId, currentAdmin(req))) { res.status(404).json({ error: "Payment method not found." }); return; }
  res.json(DeleteAdminPaymentMethodLogoResponse.parse(await adminMethod(params.data.methodId)));
});

router.put("/admin/users/:userId/withdrawal-sources", async (req, res): Promise<void> => {
  const params = UpdateUserWithdrawalSourcesParams.safeParse(req.params);
  const input = UpdateUserWithdrawalSourcesBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Choose grant, deposit or both." }); return; }
  const user = await changeUserWithdrawalSources(params.data.userId, input.data.sources, currentAdmin(req));
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  res.json(UpdateUserWithdrawalSourcesResponse.parse(user));
});

export default router;
