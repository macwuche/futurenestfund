import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  ConnectAdminMailDomainBody, CreateAdminMailboxBody, DeleteAdminMailThreadsBody, GetAdminMailDnsResponse, GetAdminMailDraftResponse, GetAdminMailRoundTripResponse,
  GetAdminMailSetupResponse, GetAdminMailThreadResponse, ListAdminMailContactsResponse, ListAdminMailThreadsResponse, ListAdminMailboxesResponse, SaveAdminMailDraftBody,
  SaveAdminMailDraftResponse, SendAdminMailBody, SendAdminMailResponse, StartAdminMailRoundTripBody, StartAdminMailRoundTripResponse, UndoAdminMailSendResponse,
  UpdateAdminMailThreadsBody, UpdateAdminMailboxBody, UploadAdminMailAttachmentResponse, UploadAdminMailSignatureLogoResponse,
} from "@workspace/api-zod";
import { currentAdmin } from "../lib/currentUser";
import {
  createMailbox, deleteDraft, deleteMailbox, deleteThreadsForever, getDraft, getThread, listMailboxes, listThreads, retryFailed, saveDraft, sendMail,
  signatureLogoUrl, undoSend, updateMailbox, updateThreads,
} from "../lib/mail";
import { connectDomain, dnsHealth, forgetDomain, mailSetupView, removeWebhook, roundTripStatus, setupWebhook, startRoundTrip, verifyMailDomain } from "../lib/mailSetup";
import { MailInputError } from "../lib/mailRules";
import { findMailFile, sendMailFile, storeComposeAttachment, storeSignatureLogo } from "../lib/mailStore";
import { RemoteImageError, fetchRemoteImage } from "../lib/remoteImage";
import { receiveFile } from "../lib/uploads";
import multer from "multer";
import { UploadError } from "../lib/uploads";

/** Mail attachments are up to 15 MB (the shared upload parser stops at 10 MB). */
const attachmentParser = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 2, parts: 3 } }).single("file");
const receiveAttachment = (req: Request, res: Response, next: NextFunction) => attachmentParser(req, res, (err: unknown) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) return next(new UploadError(err.code === "LIMIT_FILE_SIZE" ? "Attachments can be up to 15 MB each." : "Send one file in a field named \"file\"."));
  next(err);
});

type Handler = (req: Request, res: Response) => Promise<unknown>;
/** Mail errors the admin can fix become a 400 with the message. */
const wrap = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof MailInputError) { res.status(400).json({ error: err.message }); return; }
    next(err);
  }
};
const bad = (res: Response, message: string) => res.status(400).json({ error: message });

/** Public: signature logos are loaded by recipients' mail apps. Mounted before sign-in. */
export const publicMailRouter: IRouter = Router();
publicMailRouter.get("/mail/signature-logo/:fileId", async (req, res): Promise<void> => {
  const f = await findMailFile(String(req.params["fileId"]));
  await sendMailFile(req, res, f?.purpose === "logo" ? f : undefined, { publicLogo: true });
});

const router: IRouter = Router();

/* ---------- Settings → Email (Mail box part) ---------- */
router.get("/admin/mail/setup", wrap(async (_req, res) => res.json(GetAdminMailSetupResponse.parse(await mailSetupView()))));
router.post("/admin/mail/setup/domain", wrap(async (req, res) => {
  const input = ConnectAdminMailDomainBody.safeParse(req.body);
  if (!input.success) { bad(res, "Enter the domain, like futurenestfund.org."); return; }
  res.json(GetAdminMailSetupResponse.parse(await connectDomain(input.data, currentAdmin(req))));
}));
router.delete("/admin/mail/setup/domain", wrap(async (req, res) => res.json(GetAdminMailSetupResponse.parse(await forgetDomain(currentAdmin(req))))));
router.post("/admin/mail/setup/domain/verify", wrap(async (req, res) => res.json(GetAdminMailSetupResponse.parse(await verifyMailDomain(currentAdmin(req))))));
router.get("/admin/mail/setup/dns", wrap(async (_req, res) => res.json(GetAdminMailDnsResponse.parse(await dnsHealth()))));
router.post("/admin/mail/setup/webhook", wrap(async (req, res) => res.json(GetAdminMailSetupResponse.parse(await setupWebhook(currentAdmin(req))))));
router.delete("/admin/mail/setup/webhook", wrap(async (req, res) => res.json(GetAdminMailSetupResponse.parse(await removeWebhook(currentAdmin(req))))));
router.post("/admin/mail/setup/round-trip", wrap(async (req, res) => {
  const input = StartAdminMailRoundTripBody.safeParse(req.body);
  if (!input.success) { bad(res, "Choose a mailbox to test."); return; }
  res.json(StartAdminMailRoundTripResponse.parse(await startRoundTrip(input.data.mailboxId, currentAdmin(req))));
}));
router.get("/admin/mail/setup/round-trip", wrap(async (req, res) => {
  res.json(GetAdminMailRoundTripResponse.parse(await roundTripStatus(String(req.query["token"] ?? ""), String(req.query["mailboxId"] ?? ""))));
}));

/* ---------- mailboxes ---------- */
router.get("/admin/mail/mailboxes", wrap(async (_req, res) => res.json(ListAdminMailboxesResponse.parse(await listMailboxes()))));
router.post("/admin/mail/mailboxes", wrap(async (req, res) => {
  const input = CreateAdminMailboxBody.safeParse(req.body);
  if (!input.success) { bad(res, "Enter the address, like support."); return; }
  res.json(ListAdminMailboxesResponse.parse(await createMailbox(input.data, currentAdmin(req))));
}));
router.patch("/admin/mail/mailboxes/:id", wrap(async (req, res) => {
  const input = UpdateAdminMailboxBody.safeParse(req.body);
  if (!input.success) { bad(res, "Check the mailbox details: the signature has up to 3 links."); return; }
  res.json(ListAdminMailboxesResponse.parse(await updateMailbox(String(req.params["id"]), input.data, currentAdmin(req))));
}));
router.delete("/admin/mail/mailboxes/:id", wrap(async (req, res) => res.json(ListAdminMailboxesResponse.parse(await deleteMailbox(String(req.params["id"]), currentAdmin(req))))));
router.post("/admin/mail/signature-logo", receiveFile, wrap(async (req, res) => {
  const f = await storeSignatureLogo(req.file, currentAdmin(req));
  res.json(UploadAdminMailSignatureLogoResponse.parse({ id: f.id, url: signatureLogoUrl(f.id) }));
}));

/* ---------- reading ---------- */
const flag = (v: unknown) => v === "true" || v === "1";
router.get("/admin/mail/threads", wrap(async (req, res) => {
  const page = Number(req.query["page"] ?? 1);
  res.json(ListAdminMailThreadsResponse.parse(await listThreads({
    mailboxId: req.query["mailboxId"] ? String(req.query["mailboxId"]) : undefined, view: String(req.query["view"] ?? "inbox"),
    search: String(req.query["q"] ?? ""), page: Number.isFinite(page) ? page : 1, unreadOnly: flag(req.query["unread"]), hasAttachments: flag(req.query["attachments"]),
  })));
}));
router.patch("/admin/mail/threads", wrap(async (req, res) => {
  const input = UpdateAdminMailThreadsBody.safeParse(req.body);
  if (!input.success) { bad(res, "Choose up to 200 conversations."); return; }
  res.json(await updateThreads(input.data, currentAdmin(req)));
}));
router.post("/admin/mail/threads/delete", wrap(async (req, res) => {
  const input = DeleteAdminMailThreadsBody.safeParse(req.body);
  if (!input.success) { bad(res, "Choose up to 200 conversations."); return; }
  res.json(await deleteThreadsForever(input.data.ids, currentAdmin(req)));
}));
router.get("/admin/mail/threads/:id", wrap(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params["id"]))) { bad(res, "That conversation doesn't exist."); return; }
  res.json(GetAdminMailThreadResponse.parse(await getThread(String(req.params["id"]))));
}));

/* ---------- writing ---------- */
router.post("/admin/mail/drafts", wrap(async (req, res) => {
  const input = SaveAdminMailDraftBody.safeParse(req.body);
  if (!input.success) { bad(res, "The draft couldn't be read: check the recipients (up to 50 each) and attachments (up to 20)."); return; }
  res.json(SaveAdminMailDraftResponse.parse(await saveDraft(input.data, currentAdmin(req))));
}));
router.get("/admin/mail/drafts/:id", wrap(async (req, res) => res.json(GetAdminMailDraftResponse.parse(await getDraft(String(req.params["id"]))))));
router.delete("/admin/mail/drafts/:id", wrap(async (req, res) => res.json(await deleteDraft(String(req.params["id"])))));
router.post("/admin/mail/send", wrap(async (req, res) => {
  const input = SendAdminMailBody.safeParse(req.body);
  if (!input.success) { bad(res, "The email couldn't be read: check the recipients (up to 50 each) and attachments (up to 20)."); return; }
  res.json(SendAdminMailResponse.parse(await sendMail(input.data, currentAdmin(req))));
}));
router.post("/admin/mail/messages/:id/undo", wrap(async (req, res) => res.json(UndoAdminMailSendResponse.parse(await undoSend(String(req.params["id"]), currentAdmin(req))))));
router.post("/admin/mail/messages/:id/retry", wrap(async (req, res) => res.json(await retryFailed(String(req.params["id"])))));
router.post("/admin/mail/attachments", receiveAttachment, wrap(async (req, res) => {
  const f = await storeComposeAttachment(req.file, currentAdmin(req));
  res.json(UploadAdminMailAttachmentResponse.parse({
    id: f.id, name: f.originalName, mimeType: f.mimeType, size: f.sizeBytes, inline: false, contentId: null, available: true, blockedReason: null, url: `/api/admin/mail/files/${f.id}`,
  }));
}));
router.get("/admin/mail/files/:id", async (req, res): Promise<void> => {
  const f = await findMailFile(String(req.params["id"]));
  await sendMailFile(req, res, f?.purpose === "attachment" ? f : undefined);
});

/* ---------- Show images: fetched by the server, re-encoded, cached for a while ---------- */
const imageCache = new Map<string, { data: Buffer; type: string; at: number }>();
router.get("/admin/mail/image", async (req, res): Promise<void> => {
  const url = String(req.query["url"] ?? "").slice(0, 2000);
  const hit = imageCache.get(url);
  const send = (img: { data: Buffer; type: string }) => {
    res.setHeader("Content-Type", img.type);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.end(img.data);
  };
  if (hit && Date.now() - hit.at < 3_600_000) { send(hit); return; }
  try {
    const { buffer } = await fetchRemoteImage(url);
    const meta = await sharp(buffer, { limitInputPixels: 30_000_000, animated: false }).metadata();
    const data = await sharp(buffer, { limitInputPixels: 30_000_000 }).rotate().resize(1600, 4000, { fit: "inside", withoutEnlargement: true })
      [meta.hasAlpha ? "png" : "jpeg"]({ quality: 85 }).toBuffer();
    const img = { data, type: meta.hasAlpha ? "image/png" : "image/jpeg", at: Date.now() };
    if (imageCache.size > 300) imageCache.delete(imageCache.keys().next().value!);
    imageCache.set(url, img);
    send(img);
  } catch (err) {
    req.log.info({ err: err instanceof RemoteImageError ? err.message : (err as Error).message }, "Mail image not loaded");
    res.status(404).json({ error: "This image couldn't be loaded." });
  }
});

/* ---------- address suggestions ---------- */
router.get("/admin/mail/contacts", async (req, res): Promise<void> => {
  const q = String(req.query["q"] ?? "").trim().toLowerCase().slice(0, 100);
  if (q.length < 2) { res.json([]); return; }
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await db.execute<{ address: string; name: string | null }>(sql`
    select address, max(name) as name from (
      select lower(email) as address, name from demo_profiles where lower(email) like ${like} or lower(name) like ${like}
      union all
      select lower(e ->> 'address') as address, e ->> 'name' as name from demo_mail_threads t, jsonb_array_elements(t.participants) e
        where lower(e ->> 'address') like ${like} or lower(coalesce(e ->> 'name', '')) like ${like}
    ) x where address is not null group by address order by address limit 8`);
  res.json(ListAdminMailContactsResponse.parse(rows.map((r) => ({ address: r.address, name: r.name ?? null }))));
});

export default router;
