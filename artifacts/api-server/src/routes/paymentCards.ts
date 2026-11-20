import { Router, type IRouter } from "express";
import {
  ListApplicantPaymentCardsResponse, CreateApplicantPaymentCardBody, CreateApplicantPaymentCardResponse, DeleteApplicantPaymentCardParams,
  GetAdminCardPaymentsOverviewResponse, ListAdminPaymentCardsQueryParams, ListAdminPaymentCardsResponse, GetAdminPaymentCardParams, GetAdminPaymentCardResponse,
  RevealAdminPaymentCardParams, RevealAdminPaymentCardResponse, DecideAdminPaymentCardParams, DecideAdminPaymentCardBody, DecideAdminPaymentCardResponse,
  ListAdminReportedCardsQueryParams, ListAdminReportedCardsResponse, CreateAdminReportedCardBody, CreateAdminReportedCardResponse,
  ClearAdminReportedCardParams, ClearAdminReportedCardResponse,
} from "@workspace/api-zod";
import {
  adminCardDetail, cardPaymentsOverview, clearReport, decideCard, listAdminCards, listOwnCards, listReported, removeOwnCard, reportCard, revealCard, saveCard,
} from "../lib/paymentCards";
import { currentAdmin, currentUserId } from "../lib/currentUser";
import { db, demoProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Card payments (Phase 13): customers save the physical cards they collected; administrators check, block and report them. */
const router: IRouter = Router();

router.get("/applicant/payment-cards", async (req, res): Promise<void> => {
  res.json(ListApplicantPaymentCardsResponse.parse(await listOwnCards(currentUserId(req))));
});
router.post("/applicant/payment-cards", async (req, res): Promise<void> => {
  const input = CreateApplicantPaymentCardBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Fill in the name on the card, the card number, the expiry date and the CVV." }); return; }
  const id = currentUserId(req);
  const [p] = await db.select({ name: demoProfilesTable.name }).from(demoProfilesTable).where(eq(demoProfilesTable.id, id));
  res.status(201).json(CreateApplicantPaymentCardResponse.parse(await saveCard(id, input.data, p?.name ?? id)));
});
router.delete("/applicant/payment-cards/:cardId", async (req, res): Promise<void> => {
  const params = DeleteApplicantPaymentCardParams.safeParse(req.params);
  const id = currentUserId(req);
  const [p] = await db.select({ name: demoProfilesTable.name }).from(demoProfilesTable).where(eq(demoProfilesTable.id, id));
  if (!params.success || !await removeOwnCard(id, params.data.cardId, p?.name ?? id)) { res.status(404).json({ error: "Card not found." }); return; }
  res.status(204).end();
});

router.get("/admin/card-payments/overview", async (_req, res): Promise<void> => {
  res.json(GetAdminCardPaymentsOverviewResponse.parse(await cardPaymentsOverview()));
});
router.get("/admin/payment-cards", async (req, res): Promise<void> => {
  const query = ListAdminPaymentCardsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Choose a filter: all, flagged, Active, Blocked or Removed." }); return; }
  res.json(ListAdminPaymentCardsResponse.parse(await listAdminCards(query.data.filter ?? "all", query.data.q ?? "", query.data.userId)));
});
router.get("/admin/payment-cards/:cardId", async (req, res): Promise<void> => {
  const params = GetAdminPaymentCardParams.safeParse(req.params);
  const card = params.success ? await adminCardDetail(params.data.cardId) : undefined;
  if (!card) { res.status(404).json({ error: "Card not found." }); return; }
  res.json(GetAdminPaymentCardResponse.parse(card));
});
/** POST, not GET: it's audited, and the GET-only session cookie can't trigger it. */
router.post("/admin/payment-cards/:cardId/reveal", async (req, res): Promise<void> => {
  const params = RevealAdminPaymentCardParams.safeParse(req.params);
  const card = params.success ? await revealCard(params.data.cardId, currentAdmin(req)) : undefined;
  if (!card) { res.status(404).json({ error: "Card not found." }); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(RevealAdminPaymentCardResponse.parse(card));
});
router.post("/admin/payment-cards/:cardId/decision", async (req, res): Promise<void> => {
  const params = DecideAdminPaymentCardParams.safeParse(req.params);
  const input = DecideAdminPaymentCardBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose block (with a reason) or unblock." }); return; }
  const d = input.data.action === "block" ? { action: "block" as const, reason: input.data.reason ?? "", note: input.data.note ?? "" } : { action: input.data.action };
  const card = params.success ? await decideCard(params.data.cardId, d, currentAdmin(req)) : undefined;
  if (!card) { res.status(404).json({ error: "Card not found." }); return; }
  res.json(DecideAdminPaymentCardResponse.parse(card));
});

router.get("/admin/reported-cards", async (req, res): Promise<void> => {
  const query = ListAdminReportedCardsQueryParams.safeParse(req.query);
  res.json(ListAdminReportedCardsResponse.parse(await listReported(query.success ? !!query.data.cleared : false)));
});
router.post("/admin/reported-cards", async (req, res): Promise<void> => {
  const input = CreateAdminReportedCardBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Enter the card number (or choose a saved card) and why it's reported." }); return; }
  res.status(201).json(CreateAdminReportedCardResponse.parse(await reportCard(input.data, currentAdmin(req))));
});
router.post("/admin/reported-cards/:reportId/clear", async (req, res): Promise<void> => {
  const params = ClearAdminReportedCardParams.safeParse(req.params);
  const r = params.success ? await clearReport(params.data.reportId, currentAdmin(req)) : undefined;
  if (!r) { res.status(404).json({ error: "Report not found." }); return; }
  res.json(ClearAdminReportedCardResponse.parse(r));
});

export default router;
