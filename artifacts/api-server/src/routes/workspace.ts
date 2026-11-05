import { Router, type IRouter } from "express";
import {
  GetApplicantDashboardQueryParams, GetApplicantDashboardResponse,
  UpdateApplicantProfileBody, UpdateApplicantProfileResponse,
  GetApplicantAccountResponse, CreateApplicantRequestBody, CreateApplicantRequestResponse,
  GetAdminDashboardResponse, ListAdminUsersQueryParams, ListAdminUsersResponse,
  GetAdminUserParams, GetAdminUserResponse, UpdateAdminUserBody, UpdateAdminUserParams, UpdateAdminUserResponse,
  CreateUserBalanceAdjustmentBody, CreateUserBalanceAdjustmentParams, CreateUserBalanceAdjustmentResponse,
  UpdateGlobalFreezeBody, UpdateGlobalFreezeResponse, GetWithdrawalLimitsResponse, UpdateWithdrawalLimitsBody, UpdateWithdrawalLimitsResponse,
  ListAdminAuditQueryParams, ListAdminAuditResponse, ExportAdminAuditQueryParams,
  ListApplicantCardTypesResponse, BuyApplicantCardBody, BuyApplicantCardResponse, TopUpApplicantCardParams, TopUpApplicantCardBody, TopUpApplicantCardResponse,
  ListAdminCardTypesResponse, UpdateAdminCardTypesBody, UpdateAdminCardTypesResponse, TopUpUserCardParams, TopUpUserCardBody, TopUpUserCardResponse,
  ListAdminCardRequestsQueryParams, ListAdminCardRequestsResponse, DeclineAdminCardRequestParams, DeclineAdminCardRequestBody, DeclineAdminCardRequestResponse,
  IssueUserCardParams, IssueUserCardBody, IssueUserCardResponse, ChangeUserCardParams, ChangeUserCardBody, ChangeUserCardResponse,
  UpdateUserWithdrawalLimitsParams, UpdateUserWithdrawalLimitsBody, UpdateUserWithdrawalLimitsResponse,
  UpdateApplicantPreferencesBody, UpdateApplicantPreferencesResponse,
  GetApplicantMatchmakingResponse, SaveApplicantMatchmakingBody, SaveApplicantMatchmakingResponse,
  ChangeApplicantCardParams, ChangeApplicantCardBody, ChangeApplicantCardResponse,
} from "@workspace/api-zod";
import {
  ListApplicantApplicationsResponse, CreateApplicantApplicationBody, GetApplicantApplicationParams, GetApplicantApplicationResponse,
  WithdrawApplicantApplicationParams, RespondToApplicantApplicationParams, RespondToApplicantApplicationBody,
  ListApplicantMilestonesResponse, CreateApplicantMilestoneBody, UpdateApplicantMilestoneParams, UpdateApplicantMilestoneBody,
  DeleteApplicantMilestoneParams, CreateApplicantMilestoneResponse, UpdateApplicantMilestoneResponse, ListApplicantNotificationsResponse, MarkApplicantNotificationsReadResponse,
} from "@workspace/api-zod";
import {
  UploadApplicantAvatarResponse, DeleteApplicantAvatarResponse, GetApplicantKycResponse, UploadApplicantKycDocumentBody, UploadApplicantKycDocumentResponse,
  UploadApplicantApplicationDocumentParams, UploadApplicantApplicationDocumentResponse, DeleteApplicantApplicationDocumentParams,
  DeleteApplicantApplicationDocumentResponse, GetApplicantFileParams, GetAdminFileParams,
  GetAdminMeResponse, UploadAdminAvatarResponse, DeleteAdminAvatarResponse,
  UploadAdminUserAvatarParams, UploadAdminUserAvatarResponse, DeleteAdminUserAvatarParams, DeleteAdminUserAvatarResponse,
} from "@workspace/api-zod";
import {
  SearchAdminQueryParams, SearchAdminResponse, ListAdminApplicationsQueryParams, ListAdminApplicationsResponse,
  GetAdminApplicationParams, GetAdminApplicationResponse, DecideAdminApplicationParams, DecideAdminApplicationBody, DecideAdminApplicationResponse,
  ListAdminRequestsQueryParams, ListAdminRequestsResponse, ApproveAdminRequestParams, ApproveAdminRequestBody, ApproveAdminRequestResponse,
  RejectAdminRequestParams, RejectAdminRequestBody, RejectAdminRequestResponse, ListAdminTransactionsQueryParams, ListAdminTransactionsResponse,
  ExportAdminTransactionsQueryParams, GetAdminKycQueueResponse, ReviewAdminKycDocumentParams, ReviewAdminKycDocumentBody, ReviewAdminKycDocumentResponse,
} from "@workspace/api-zod";
import { db, demoProfilesTable } from "@workspace/db";
import { changeCard, changeOwnCard, declineCardActivation, issueCard, listCardRequests, topUpCard } from "../lib/cards";
import { adminCardTypes, applicantCardTypes, changeCardTypes } from "../lib/cardTypes";
import {
  adminSearch, listAdminApplications, adminApplicationDetail, decideApplication, listAdminRequests, approveRequest, rejectRequest,
  listLedger, exportLedgerCsv, adminKycQueue, reviewKycDocument,
  globalWithdrawalLimits, changeGlobalWithdrawalLimits, changeUserWithdrawalLimits, listAudit, exportAuditCsv,
} from "../lib/adminOps";
import { receiveFile, receiveRequestForm, findFile, sendFile } from "../lib/uploads";
import { applicantKyc, uploadKycDocument } from "../lib/kyc";
import { setAvatar, clearAvatar, adminAccount, setAdminAvatar, clearAdminAvatar } from "../lib/avatars";
import { currentAdmin, currentAdminProfile, currentUserId } from "../lib/currentUser";
import { listNotifications, markAllRead } from "../lib/notifications";
import { getMatchmaking, saveMatchmaking } from "../lib/matchmaking";
import {
  listApplications, applicationDetail, createApplication, withdrawApplication, respondToApplication,
  listMilestones, createMilestone, setMilestoneDone, deleteMilestone, attachApplicationDocument, removeApplicationDocument,
} from "../lib/applicantRecords";
import { eq } from "drizzle-orm";
import { adminDashboard, applicantDashboard, applicantProfile, listUsers, getUser, changeProfile, adjustBalance, changeGlobalFreeze, changePreferences, applicantAccount, createApplicantRequest, DemoInputError } from "../lib/demoWorkspace";

const router: IRouter = Router();
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Workspace-Mode", req.identity?.mode ?? "demo");
  next();
});

router.get("/applicant/dashboard", async (req, res): Promise<void> => {
  const query = GetApplicantDashboardQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Choose weekly or monthly." }); return; }
  res.json(GetApplicantDashboardResponse.parse(await applicantDashboard(currentUserId(req), query.data.period === "monthly")));
});

router.patch("/applicant/profile", async (req, res): Promise<void> => {
  const input = UpdateApplicantProfileBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.message }); return; }
  const id = currentUserId(req);
  await changeProfile(id, input.data, req.identity!.name);
  const [person] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, id));
  res.json(UpdateApplicantProfileResponse.parse(applicantProfile(person!)));
});

router.patch("/applicant/preferences", async (req, res): Promise<void> => {
  const input = UpdateApplicantPreferencesBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose whether to get email notifications." }); return; }
  res.json(UpdateApplicantPreferencesResponse.parse(await changePreferences(currentUserId(req), input.data, req.identity!.name)));
});

router.get("/applicant/matchmaking", async (req, res): Promise<void> => {
  res.json(GetApplicantMatchmakingResponse.parse(await getMatchmaking(currentUserId(req))));
});
router.put("/applicant/matchmaking", async (req, res): Promise<void> => {
  const input = SaveApplicantMatchmakingBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Answer every question: organization type, at least one focus area and goal, funding size and timing." }); return; }
  res.json(SaveApplicantMatchmakingResponse.parse(await saveMatchmaking(currentUserId(req), input.data, req.identity!.name)));
});

router.get("/applicant/account", async (req, res): Promise<void> => {
  res.json(GetApplicantAccountResponse.parse(await applicantAccount(currentUserId(req))));
});

router.get("/applicant/card-types", async (_req, res): Promise<void> => {
  res.json(ListApplicantCardTypesResponse.parse(await applicantCardTypes()));
});

router.post("/applicant/cards", async (req, res): Promise<void> => {
  const input = BuyApplicantCardBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose a card type and a virtual or physical card." }); return; }
  const id = currentUserId(req);
  await issueCard(id, { kind: input.data.kind, type: input.data.type, actor: req.identity!.name, by: "applicant" });
  res.json(BuyApplicantCardResponse.parse(await applicantAccount(id)));
});

router.post("/applicant/cards/:cardId/top-up", async (req, res): Promise<void> => {
  const params = TopUpApplicantCardParams.safeParse(req.params);
  const input = TopUpApplicantCardBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Enter an amount between $0.01 and $1,000,000." }); return; }
  const id = currentUserId(req);
  if (!await topUpCard(id, params.data.cardId, input.data.amount, req.identity!.name, "applicant")) { res.status(404).json({ error: "Card not found." }); return; }
  res.json(TopUpApplicantCardResponse.parse(await applicantAccount(id)));
});

router.post("/applicant/cards/:cardId/actions", async (req, res): Promise<void> => {
  const params = ChangeApplicantCardParams.safeParse(req.params);
  const input = ChangeApplicantCardBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Choose freeze, unfreeze or request activation." }); return; }
  const id = currentUserId(req);
  if (!await changeOwnCard(id, params.data.cardId, input.data.action, req.identity!.name)) { res.status(404).json({ error: "Card not found." }); return; }
  res.json(ChangeApplicantCardResponse.parse(await applicantAccount(id)));
});

router.post("/applicant/requests", receiveRequestForm, async (req, res): Promise<void> => {
  const body = { ...(req.body ?? {}) };
  delete body.file;
  const input = CreateApplicantRequestBody.omit({ file: true }).safeParse(body);
  if (!input.success) { res.status(400).json({ error: "Choose a method and enter an amount (note under 240 characters)." }); return; }
  let values: unknown = {};
  if (input.data.values) {
    try { values = JSON.parse(input.data.values); } catch { res.status(400).json({ error: "The method's details couldn't be read. Refresh the page and try again." }); return; }
  }
  const amount = Number(input.data.amount);
  res.status(201).json(CreateApplicantRequestResponse.parse(await createApplicantRequest(currentUserId(req), {
    kind: input.data.kind, methodId: input.data.methodId, amount, source: input.data.source, values, note: input.data.note,
  }, req.file)));
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

router.post("/applicant/applications/:applicationId/documents", receiveFile, async (req, res): Promise<void> => {
  const params = UploadApplicantApplicationDocumentParams.safeParse(req.params);
  const detail = params.success ? await attachApplicationDocument(currentUserId(req), params.data.applicationId, req.file) : undefined;
  if (!detail) { res.status(404).json({ error: "Application not found." }); return; }
  res.status(201).json(UploadApplicantApplicationDocumentResponse.parse(detail));
});
router.delete("/applicant/applications/:applicationId/documents/:fileId", async (req, res): Promise<void> => {
  const params = DeleteApplicantApplicationDocumentParams.safeParse(req.params);
  const detail = params.success ? await removeApplicationDocument(currentUserId(req), params.data.applicationId, params.data.fileId) : undefined;
  if (!detail) { res.status(404).json({ error: "Document not found." }); return; }
  res.json(DeleteApplicantApplicationDocumentResponse.parse(detail));
});

/* ---------- files, profile photo and identity documents ---------- */
router.get("/applicant/files/:fileId", async (req, res): Promise<void> => {
  const params = GetApplicantFileParams.safeParse(req.params);
  await sendFile(req, res, params.success ? await findFile(params.data.fileId, currentUserId(req)) : undefined);
});
router.post("/applicant/avatar", receiveFile, async (req, res): Promise<void> => {
  const id = currentUserId(req);
  await setAvatar(id, req.file);
  res.json(UploadApplicantAvatarResponse.parse(await profileOf(id)));
});
router.delete("/applicant/avatar", async (req, res): Promise<void> => {
  const id = currentUserId(req);
  await clearAvatar(id);
  res.json(DeleteApplicantAvatarResponse.parse(await profileOf(id)));
});
router.get("/applicant/kyc", async (req, res): Promise<void> => {
  res.json(GetApplicantKycResponse.parse(await applicantKyc(currentUserId(req))));
});
router.post("/applicant/kyc/documents", receiveFile, async (req, res): Promise<void> => {
  const input = UploadApplicantKycDocumentBody.pick({ kind: true }).safeParse(req.body ?? {});
  if (!input.success) { res.status(400).json({ error: "Choose which document this is: Government ID or Proof of address." }); return; }
  res.status(201).json(UploadApplicantKycDocumentResponse.parse(await uploadKycDocument(currentUserId(req), input.data.kind, req.file)));
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

router.get("/admin/files/:fileId", async (req, res): Promise<void> => {
  const params = GetAdminFileParams.safeParse(req.params);
  await sendFile(req, res, params.success ? await findFile(params.data.fileId) : undefined);
});

/* ---------- profile photos: the administrator's own, and a user's from the inspector ---------- */
router.get("/admin/me", async (req, res): Promise<void> => {
  res.json(GetAdminMeResponse.parse(await adminAccount(currentAdminProfile(req))));
});
router.post("/admin/me/avatar", receiveFile, async (req, res): Promise<void> => {
  const who = currentAdminProfile(req);
  await setAdminAvatar(who, req.file);
  res.json(UploadAdminAvatarResponse.parse(await adminAccount(who)));
});
router.delete("/admin/me/avatar", async (req, res): Promise<void> => {
  const who = currentAdminProfile(req);
  await clearAdminAvatar(who);
  res.json(DeleteAdminAvatarResponse.parse(await adminAccount(who)));
});
router.post("/admin/users/:userId/avatar", receiveFile, async (req, res): Promise<void> => {
  const params = UploadAdminUserAvatarParams.safeParse(req.params);
  if (!params.success || !await setAvatar(params.data.userId, req.file, currentAdmin(req))) { res.status(404).json({ error: "User not found." }); return; }
  res.json(UploadAdminUserAvatarResponse.parse(await getUser(params.data.userId)));
});
router.delete("/admin/users/:userId/avatar", async (req, res): Promise<void> => {
  const params = DeleteAdminUserAvatarParams.safeParse(req.params);
  if (!params.success || !await clearAvatar(params.data.userId, currentAdmin(req))) { res.status(404).json({ error: "User not found." }); return; }
  res.json(DeleteAdminUserAvatarResponse.parse(await getUser(params.data.userId)));
});

router.get("/admin/dashboard", async (_req, res): Promise<void> => {
  res.json(GetAdminDashboardResponse.parse(await adminDashboard()));
});

router.get("/admin/users", async (req, res): Promise<void> => {
  const query = ListAdminUsersQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid directory filters." }); return; }
  res.json(ListAdminUsersResponse.parse(await listUsers(query.data)));
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
  if (!await changeProfile(params.data.userId, input.data, currentAdmin(req))) { res.status(404).json({ error: "User not found." }); return; }
  res.json(UpdateAdminUserResponse.parse(await getUser(params.data.userId)));
});

router.post("/admin/users/:userId/balance-adjustments", async (req, res): Promise<void> => {
  const params = CreateUserBalanceAdjustmentParams.safeParse(req.params);
  const input = CreateUserBalanceAdjustmentBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Enter a positive amount, the account and a reason of at least 5 characters." }); return; }
  try {
    const result = await adjustBalance(params.data.userId, input.data.account, input.data.amount, input.data.reason, currentAdmin(req), input.data.direction);
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
  res.json(UpdateGlobalFreezeResponse.parse(await changeGlobalFreeze(input.data.frozen, currentAdmin(req), input.data.reason)));
});

router.get("/admin/system/withdrawal-limits", async (_req, res): Promise<void> => {
  res.json(GetWithdrawalLimitsResponse.parse(await globalWithdrawalLimits()));
});

router.put("/admin/system/withdrawal-limits", async (req, res): Promise<void> => {
  const input = UpdateWithdrawalLimitsBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Enter each limit as an amount, or leave it empty for no limit." }); return; }
  res.json(UpdateWithdrawalLimitsResponse.parse(await changeGlobalWithdrawalLimits(input.data, currentAdmin(req))));
});

router.post("/admin/users/:userId/cards", async (req, res): Promise<void> => {
  const params = IssueUserCardParams.safeParse(req.params);
  const input = IssueUserCardBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Choose a virtual or physical card and its type." }); return; }
  const type = input.data.type ?? (input.data.network === "Mastercard" ? "mastercard-debit" : input.data.network === "Visa" ? "visa-debit" : undefined);
  if (!type) { res.status(400).json({ error: "Choose a card type." }); return; }
  const user = await issueCard(params.data.userId, { kind: input.data.kind, type, actor: currentAdmin(req), by: "admin", freeOfCharge: input.data.freeOfCharge === true });
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  res.json(IssueUserCardResponse.parse(user));
});

router.get("/admin/card-types", async (_req, res): Promise<void> => {
  res.json(ListAdminCardTypesResponse.parse(await adminCardTypes()));
});

router.put("/admin/card-types", async (req, res): Promise<void> => {
  const input = UpdateAdminCardTypesBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Each price and fee must be 0 or more (fees up to 100%)." }); return; }
  res.json(UpdateAdminCardTypesResponse.parse(await changeCardTypes(input.data, currentAdmin(req))));
});

router.post("/admin/users/:userId/cards/:cardId/top-up", async (req, res): Promise<void> => {
  const params = TopUpUserCardParams.safeParse(req.params);
  const input = TopUpUserCardBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Enter an amount between $0.01 and $1,000,000." }); return; }
  const user = await topUpCard(params.data.userId, params.data.cardId, input.data.amount, currentAdmin(req), "admin");
  if (!user) { res.status(404).json({ error: "User or card not found." }); return; }
  res.json(TopUpUserCardResponse.parse(user));
});

router.post("/admin/users/:userId/cards/:cardId/actions", async (req, res): Promise<void> => {
  const params = ChangeUserCardParams.safeParse(req.params);
  const input = ChangeUserCardBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Choose activate, freeze, unfreeze or cancel (reason up to 240 characters)." }); return; }
  const user = await changeCard(params.data.userId, params.data.cardId, input.data.action, currentAdmin(req), input.data.reason);
  if (!user) { res.status(404).json({ error: "User or card not found." }); return; }
  res.json(ChangeUserCardResponse.parse(user));
});

router.get("/admin/card-requests", async (req, res): Promise<void> => {
  const query = ListAdminCardRequestsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Choose the requested or awaiting tab." }); return; }
  res.json(ListAdminCardRequestsResponse.parse(await listCardRequests(query.data.status)));
});

router.post("/admin/card-requests/:userId/:cardId/decline", async (req, res): Promise<void> => {
  const params = DeclineAdminCardRequestParams.safeParse(req.params);
  const input = DeclineAdminCardRequestBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Give the user a reason of 5 to 240 characters." }); return; }
  const user = await declineCardActivation(params.data.userId, params.data.cardId, input.data.reason, currentAdmin(req));
  if (!user) { res.status(404).json({ error: "User or card not found." }); return; }
  res.json(DeclineAdminCardRequestResponse.parse(user));
});

router.put("/admin/users/:userId/withdrawal-limits", async (req, res): Promise<void> => {
  const params = UpdateUserWithdrawalLimitsParams.safeParse(req.params);
  const input = UpdateUserWithdrawalLimitsBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Choose the global limits or enter custom ones." }); return; }
  const user = await changeUserWithdrawalLimits(params.data.userId, input.data, currentAdmin(req));
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  res.json(UpdateUserWithdrawalLimitsResponse.parse(user));
});

/* ---------- admin operations ---------- */
router.get("/admin/search", async (req, res): Promise<void> => {
  const query = SearchAdminQueryParams.safeParse(req.query);
  if (!query.success || !query.data.q.trim()) { res.status(400).json({ error: "Enter 1–100 characters to search." }); return; }
  res.json(SearchAdminResponse.parse(await adminSearch(query.data.q)));
});

router.get("/admin/applications", async (req, res): Promise<void> => {
  const query = ListAdminApplicationsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid application filters." }); return; }
  res.json(ListAdminApplicationsResponse.parse(await listAdminApplications(query.data.status, query.data.userId)));
});
router.get("/admin/applications/:applicationId", async (req, res): Promise<void> => {
  const params = GetAdminApplicationParams.safeParse(req.params);
  const detail = params.success ? await adminApplicationDetail(params.data.applicationId) : undefined;
  if (!detail) { res.status(404).json({ error: "Application not found." }); return; }
  res.json(GetAdminApplicationResponse.parse(detail));
});
router.post("/admin/applications/:applicationId/decision", async (req, res): Promise<void> => {
  const params = DecideAdminApplicationParams.safeParse(req.params);
  const input = DecideAdminApplicationBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose Review, Approved, Declined or Changes requested, with a note under 1000 characters." }); return; }
  const detail = params.success ? await decideApplication(params.data.applicationId, input.data.status, input.data.note, currentAdmin(req)) : undefined;
  if (!detail) { res.status(404).json({ error: "Application not found." }); return; }
  res.json(DecideAdminApplicationResponse.parse(detail));
});

router.get("/admin/requests", async (req, res): Promise<void> => {
  const query = ListAdminRequestsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Choose Deposit or Withdrawal requests." }); return; }
  res.json(ListAdminRequestsResponse.parse(await listAdminRequests(query.data.kind, query.data.status)));
});
router.post("/admin/requests/:requestId/approve", async (req, res): Promise<void> => {
  const params = ApproveAdminRequestParams.safeParse(req.params);
  const input = ApproveAdminRequestBody.safeParse(req.body ?? {});
  if (!input.success) { res.status(400).json({ error: "Keep the note to 240 characters or fewer." }); return; }
  const result = params.success ? await approveRequest(params.data.requestId, currentAdmin(req), input.data.note) : undefined;
  if (!result) { res.status(404).json({ error: "Request not found." }); return; }
  res.json(ApproveAdminRequestResponse.parse(result));
});
router.post("/admin/requests/:requestId/reject", async (req, res): Promise<void> => {
  const params = RejectAdminRequestParams.safeParse(req.params);
  const input = RejectAdminRequestBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Give a reason of 5–240 characters." }); return; }
  const result = params.success ? await rejectRequest(params.data.requestId, input.data.reason, currentAdmin(req)) : undefined;
  if (!result) { res.status(404).json({ error: "Request not found." }); return; }
  res.json(RejectAdminRequestResponse.parse(result));
});

router.get("/admin/transactions", async (req, res): Promise<void> => {
  const query = ListAdminTransactionsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Check the ledger filters (dates as YYYY-MM-DD)." }); return; }
  const { page, ...filters } = query.data;
  res.json(ListAdminTransactionsResponse.parse(await listLedger(filters, page)));
});
router.get("/admin/transactions/export", async (req, res): Promise<void> => {
  const query = ExportAdminTransactionsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Check the ledger filters (dates as YYYY-MM-DD)." }); return; }
  const { page: _page, ...filters } = query.data;
  const csv = await exportLedgerCsv(filters);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="ledger-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

router.get("/admin/audit", async (req, res): Promise<void> => {
  const query = ListAdminAuditQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Check the audit filters (dates as YYYY-MM-DD)." }); return; }
  const { page, ...filters } = query.data;
  res.json(ListAdminAuditResponse.parse(await listAudit(filters, page)));
});
router.get("/admin/audit/export", async (req, res): Promise<void> => {
  const query = ExportAdminAuditQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Check the audit filters (dates as YYYY-MM-DD)." }); return; }
  const { page: _page, ...filters } = query.data;
  const csv = await exportAuditCsv(filters);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

router.get("/admin/kyc", async (_req, res): Promise<void> => {
  res.json(GetAdminKycQueueResponse.parse(await adminKycQueue()));
});
router.post("/admin/kyc/documents/:documentId/review", async (req, res): Promise<void> => {
  const params = ReviewAdminKycDocumentParams.safeParse(req.params);
  const input = ReviewAdminKycDocumentBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose Verified or Rejected, with a note under 240 characters." }); return; }
  const result = params.success ? await reviewKycDocument(params.data.documentId, input.data.decision, input.data.note, currentAdmin(req)) : undefined;
  if (!result) { res.status(404).json({ error: "Document not found." }); return; }
  res.json(ReviewAdminKycDocumentResponse.parse(result));
});

export default router;

async function profileOf(id: string) {
  const [person] = await db.select().from(demoProfilesTable).where(eq(demoProfilesTable.id, id));
  if (!person) throw new Error("Profile missing");
  return applicantProfile(person);
}
