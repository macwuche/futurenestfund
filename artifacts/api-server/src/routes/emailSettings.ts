import { Router, type IRouter } from "express";
import {
  CheckEmailHealthResponse, GetEmailSettingsResponse, RemoveEmailSecretParams, RemoveEmailSecretResponse, SendTestEmailBody,
  SendTestEmailResponse, UpdateEmailSettingsBody, UpdateEmailSettingsResponse,
} from "@workspace/api-zod";
import { currentAdmin } from "../lib/currentUser";
import { emailHealth, emailSettingsView, removeEmailSecret, saveEmailSettings, sendTestEmail } from "../lib/emailSettings";

/** Admin Settings → Email (under /admin, so admins only). Secrets are write-only: responses carry hints, never values. */
const router: IRouter = Router();

router.get("/admin/settings/email", (_req, res): void => {
  res.json(GetEmailSettingsResponse.parse(emailSettingsView()));
});

router.put("/admin/settings/email", async (req, res): Promise<void> => {
  const input = UpdateEmailSettingsBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Some email settings aren't valid. Check each field and try again." }); return; }
  res.json(UpdateEmailSettingsResponse.parse(await saveEmailSettings(input.data, currentAdmin(req))));
});

router.delete("/admin/settings/email/secrets/:name", async (req, res): Promise<void> => {
  const params = RemoveEmailSecretParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Unknown secret." }); return; }
  res.json(RemoveEmailSecretResponse.parse(await removeEmailSecret(params.data.name, currentAdmin(req))));
});

router.post("/admin/settings/email/check", async (_req, res): Promise<void> => {
  res.json(CheckEmailHealthResponse.parse(await emailHealth()));
});

router.post("/admin/settings/email/test", async (req, res): Promise<void> => {
  const input = SendTestEmailBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Enter the address to send the test email to." }); return; }
  res.json(SendTestEmailResponse.parse(await sendTestEmail(input.data.to, currentAdmin(req))));
});

export default router;
