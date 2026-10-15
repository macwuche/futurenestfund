import { Router, type IRouter } from "express";
import {
  GetApplicantDashboardQueryParams, GetApplicantDashboardResponse,
  UpdateApplicantProfileBody, UpdateApplicantProfileResponse,
  GetApplicantAccountResponse, CreateApplicantRequestBody, CreateApplicantRequestResponse,
  GetAdminDashboardResponse, ListAdminUsersQueryParams, ListAdminUsersResponse,
  GetAdminUserParams, GetAdminUserResponse, UpdateAdminUserBody, UpdateAdminUserParams, UpdateAdminUserResponse,
  CreateUserBalanceAdjustmentBody, CreateUserBalanceAdjustmentParams, CreateUserBalanceAdjustmentResponse,
  UpdateGlobalFreezeBody, UpdateGlobalFreezeResponse,
} from "@workspace/api-zod";
import { db, demoProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminDashboard, applicantDashboard, applicantProfile, demoApplicantId, listUsers, getUser, changeProfile, adjustBalance, changeGlobalFreeze, applicantAccount, createApplicantRequest, DemoInputError } from "../lib/demoWorkspace";

const router: IRouter = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Workspace-Mode", "demo");
  next();
});

router.get("/applicant/dashboard", async (req, res): Promise<void> => {
  const query = GetApplicantDashboardQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Choose weekly or monthly." }); return; }
  res.json(GetApplicantDashboardResponse.parse(await applicantDashboard(query.data.period === "monthly")));
});

router.patch("/applicant/profile", async (req, res): Promise<void> => {
  const input = UpdateApplicantProfileBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  await changeProfile(demoApplicantId, input.data, "Demo applicant");
  const [person] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, demoApplicantId));
  res.json(UpdateApplicantProfileResponse.parse(applicantProfile(person!)));
});

router.get("/applicant/account", async (_req, res): Promise<void> => {
  res.json(GetApplicantAccountResponse.parse(await applicantAccount()));
});

router.post("/applicant/requests", async (req, res): Promise<void> => {
  const input = CreateApplicantRequestBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Enter an amount of at least $0.01 and a note under 240 characters." }); return; }
  res.status(201).json(CreateApplicantRequestResponse.parse(await createApplicantRequest(input.data.kind, input.data.amount, input.data.note)));
});

router.get("/admin/dashboard", async (_req, res): Promise<void> => {
  res.json(GetAdminDashboardResponse.parse(await adminDashboard()));
});

router.get("/admin/users", async (req, res): Promise<void> => {
  const query = ListAdminUsersQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid directory filters." }); return; }
  res.json(ListAdminUsersResponse.parse(await listUsers(query.data.search, query.data.status)));
});

router.get("/admin/users/:userId", async (req, res): Promise<void> => {
  const params = GetAdminUserParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid user ID." }); return; }
  const person = await getUser(params.data.userId);
  if (!person) { res.status(404).json({ error: "User not found." }); return; }
  res.json(GetAdminUserResponse.parse(person));
});

router.patch("/admin/users/:userId", async (req, res): Promise<void> => {
  const params = UpdateAdminUserParams.safeParse(req.params);
  const input = UpdateAdminUserBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Check the profile fields." }); return; }
  if (!await changeProfile(params.data.userId, input.data, "Demo administrator")) { res.status(404).json({ error: "User not found." }); return; }
  res.json(UpdateAdminUserResponse.parse(await getUser(params.data.userId)));
});

router.post("/admin/users/:userId/balance-adjustments", async (req, res): Promise<void> => {
  const params = CreateUserBalanceAdjustmentParams.safeParse(req.params);
  const input = CreateUserBalanceAdjustmentBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Enter a positive amount and an adjustment reason." }); return; }
  try {
    const result = await adjustBalance(params.data.userId, input.data.account, input.data.amount, input.data.reason);
    if (!result) { res.status(404).json({ error: "User not found." }); return; }
    res.json(CreateUserBalanceAdjustmentResponse.parse(result));
  } catch (error) {
    if (!(error instanceof DemoInputError)) throw error;
    res.status(400).json({ error: error.message });
  }
});

router.patch("/admin/system/freeze", async (req, res): Promise<void> => {
  const input = UpdateGlobalFreezeBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Invalid freeze request." }); return; }
  res.json(UpdateGlobalFreezeResponse.parse(await changeGlobalFreeze(input.data.frozen, input.data.reason)));
});

export default router;
