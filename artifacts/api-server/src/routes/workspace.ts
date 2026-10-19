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
import {
  ListApplicantApplicationsResponse, CreateApplicantApplicationBody, GetApplicantApplicationParams, GetApplicantApplicationResponse,
  WithdrawApplicantApplicationParams, RespondToApplicantApplicationParams, RespondToApplicantApplicationBody,
  ListApplicantMilestonesResponse, CreateApplicantMilestoneBody, UpdateApplicantMilestoneParams, UpdateApplicantMilestoneBody,
  DeleteApplicantMilestoneParams, CreateApplicantMilestoneResponse, UpdateApplicantMilestoneResponse, ListApplicantNotificationsResponse, MarkApplicantNotificationsReadResponse,
} from "@workspace/api-zod";
import { db, demoProfilesTable } from "@workspace/db";
import { currentUserId } from "../lib/currentUser";
import { listNotifications, markAllRead } from "../lib/notifications";
import {
  listApplications, applicationDetail, createApplication, withdrawApplication, respondToApplication,
  listMilestones, createMilestone, setMilestoneDone, deleteMilestone,
} from "../lib/applicantRecords";
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

/* ---------- applications ---------- */
router.get("/applicant/applications", async (req, res): Promise<void> => {
  res.json(ListApplicantApplicationsResponse.parse(await listApplications(currentUserId(req))));
});
router.post("/applicant/applications", async (req, res): Promise<void> => {
  const input = CreateApplicantApplicationBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Enter a title (3–120 characters), a category and an amount between $100 and $10,000,000." }); return; }
  res.status(201).json(GetApplicantApplicationResponse.parse(await createApplication(currentUserId(req), input.data)));
});
router.get("/applicant/applications/:applicationId", async (req, res): Promise<void> => {
  const params = GetApplicantApplicationParams.safeParse(req.params);
  const detail = params.success ? await applicationDetail(currentUserId(req), params.data.applicationId) : undefined;
  if (!detail) { res.status(404).json({ error: "Application not found." }); return; }
  res.json(GetApplicantApplicationResponse.parse(detail));
});
router.post("/applicant/applications/:applicationId/withdraw", async (req, res): Promise<void> => {
  const params = WithdrawApplicantApplicationParams.safeParse(req.params);
  const detail = params.success ? await withdrawApplication(currentUserId(req), params.data.applicationId) : undefined;
  if (!detail) { res.status(404).json({ error: "Application not found." }); return; }
  res.json(GetApplicantApplicationResponse.parse(detail));
});
router.post("/applicant/applications/:applicationId/respond", async (req, res): Promise<void> => {
  const params = RespondToApplicantApplicationParams.safeParse(req.params);
  const input = RespondToApplicantApplicationBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Write a reply of 5–1000 characters; a revised amount must be at least $100." }); return; }
  const detail = params.success ? await respondToApplication(currentUserId(req), params.data.applicationId, input.data) : undefined;
  if (!detail) { res.status(404).json({ error: "Application not found." }); return; }
  res.json(GetApplicantApplicationResponse.parse(detail));
});

/* ---------- milestones ---------- */
router.get("/applicant/milestones", async (req, res): Promise<void> => {
  res.json(ListApplicantMilestonesResponse.parse(await listMilestones(currentUserId(req))));
});
router.post("/applicant/milestones", async (req, res): Promise<void> => {
  const input = CreateApplicantMilestoneBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Enter a milestone (3–120 characters), a grant and a due date." }); return; }
  res.status(201).json(CreateApplicantMilestoneResponse.parse(await createMilestone(currentUserId(req), input.data)));
});
router.patch("/applicant/milestones/:milestoneId", async (req, res): Promise<void> => {
  const params = UpdateApplicantMilestoneParams.safeParse(req.params);
  const input = UpdateApplicantMilestoneBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Send done: true or false." }); return; }
  const row = params.success ? await setMilestoneDone(currentUserId(req), params.data.milestoneId, input.data.done) : undefined;
  if (!row) { res.status(404).json({ error: "Milestone not found." }); return; }
  res.json(UpdateApplicantMilestoneResponse.parse(row));
});
router.delete("/applicant/milestones/:milestoneId", async (req, res): Promise<void> => {
  const params = DeleteApplicantMilestoneParams.safeParse(req.params);
  if (!params.success || !await deleteMilestone(currentUserId(req), params.data.milestoneId)) { res.status(404).json({ error: "Milestone not found." }); return; }
  res.status(204).end();
});

/* ---------- notifications ---------- */
router.get("/applicant/notifications", async (req, res): Promise<void> => {
  res.json(ListApplicantNotificationsResponse.parse(await listNotifications(currentUserId(req))));
});
router.post("/applicant/notifications/read", async (req, res): Promise<void> => {
  res.json(MarkApplicantNotificationsReadResponse.parse(await markAllRead(currentUserId(req))));
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
