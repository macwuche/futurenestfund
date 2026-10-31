import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { EmailError, emailConfigured, emailRuntime, reportHookCall, sendEmail, type OutgoingEmail } from "./email";
import { authEmail, type AuthEmailKind } from "./emailTemplates";
import { logger } from "./logger";

/**
 * Supabase Auth's Send Email Hook: Supabase POSTs each auth email here (signed with Standard Webhooks) instead of
 * sending it, and we send it through Resend. Configure in the Supabase dashboard → Authentication → Hooks →
 * Send Email → HTTPS, URL `<api>/api/hooks/supabase/send-email`, and copy the generated secret into Admin Settings → Email
 * (or SEND_EMAIL_HOOK_SECRET). The secret in use is read on every call, so a change in Settings applies at once.
 */
/** The signing key inside a `v1,whsec_<base64>` secret. */
export const hookKey = (raw: string | null | undefined) => (raw ? Buffer.from(raw.trim().replace(/^v1,/, "").replace(/^whsec_/, ""), "base64") : null);
const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, "");
const TOLERANCE_SECONDS = 5 * 60;

/** Standard Webhooks check: HMAC-SHA256 over `id.timestamp.body`, timestamp within five minutes. */
export function verifyHookSignature(body: Buffer, id: string | undefined, timestamp: string | undefined, signatures: string | undefined, key = hookKey(emailRuntime().hookSecret)): boolean {
  if (!key || !id || !timestamp || !signatures || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest();
  return signatures.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const Payload = z.object({
  user: z.object({
    email: z.string().email(),
    new_email: z.string().email().optional().nullable(),
    user_metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  }),
  email_data: z.object({
    email_action_type: z.string(),
    token: z.string().optional().nullable(),
    token_hash: z.string().optional().nullable(),
    token_new: z.string().optional().nullable(),
    token_hash_new: z.string().optional().nullable(),
    redirect_to: z.string().optional().nullable(),
    old_email: z.string().optional().nullable(),
  }),
});
type HookPayload = z.infer<typeof Payload>;

class HookInputError extends Error {}

const NOTIFICATIONS = new Set<string>([
  "password_changed_notification", "email_changed_notification", "phone_changed_notification", "identity_linked_notification",
  "identity_unlinked_notification", "mfa_factor_enrolled_notification", "mfa_factor_unenrolled_notification",
]);

/** The email(s) one hook call should send. Exported for tests. */
export function emailsFor({ user, email_data: d }: HookPayload): OutgoingEmail[] {
  const name = typeof user.user_metadata?.name === "string" ? user.user_metadata.name.slice(0, 120) : undefined;
  /**
   * The link in the email. With APP_URL set it opens the app's /auth/confirm page with the one-time token hash, which the
   * page exchanges with verifyOtp: no session tokens in the address bar, works on any device, and link scanners that
   * pre-fetch URLs don't use it up. Without APP_URL it falls back to Supabase's own verify endpoint.
   */
  const verify = (hash: string | null | undefined) => {
    if (!hash) throw new HookInputError(`Missing token hash for ${d.email_action_type}.`);
    if (appUrl) {
      const q = new URLSearchParams({ token_hash: hash, type: d.email_action_type });
      const next = nextPath(d.redirect_to);
      if (next) q.set("next", next);
      return `${appUrl}/auth/confirm?${q}`;
    }
    if (!supabaseUrl) throw new HookInputError("Neither APP_URL nor SUPABASE_URL is set.");
    const q = new URLSearchParams({ token: hash, type: d.email_action_type });
    if (d.redirect_to) q.set("redirect_to", d.redirect_to);
    return `${supabaseUrl}/auth/v1/verify?${q}`;
  };
  const action = d.email_action_type;
  switch (action) {
    case "signup": case "recovery": case "magiclink": case "invite":
      return [authEmail(action, user.email, { name, link: verify(d.token_hash) })];
    case "email_change": {
      if (!user.new_email) throw new HookInputError("email_change without a new address.");
      // Supabase's field names are reversed for backward compatibility: with Secure Email Change on, the CURRENT
      // address gets token_hash_new and the NEW address gets token_hash.
      if (d.token_hash_new) {
        return [
          authEmail("email_change_current", user.email, { name, link: verify(d.token_hash_new), newEmail: user.new_email }),
          authEmail("email_change_new", user.new_email, { name, link: verify(d.token_hash) }),
        ];
      }
      return [authEmail("email_change_new", user.new_email, { name, link: verify(d.token_hash) })];
    }
    case "reauthentication": case "email":
      if (!d.token) throw new HookInputError(`Missing code for ${action}.`);
      return [authEmail(action, user.email, { name, code: d.token })];
    default:
      if (!NOTIFICATIONS.has(action)) throw new HookInputError(`Unsupported email type ${action}.`);
      // An email-change notice goes to the old address: that's the person who needs to know.
      if (action === "email_changed_notification") {
        return [authEmail(action, d.old_email || user.email, { name, oldEmail: d.old_email ?? undefined, newEmail: user.email })];
      }
      return [authEmail(action as AuthEmailKind, user.email, { name })];
  }
}

/** The page to open after confirming: only a path on APP_URL itself (Supabase already checked redirect_to against its allow list). */
function nextPath(redirectTo: string | null | undefined): string | null {
  if (!redirectTo || !appUrl) return null;
  try {
    const target = new URL(redirectTo), app = new URL(appUrl);
    if (target.origin !== app.origin) return null;
    const p = target.pathname.slice(app.pathname.replace(/\/$/, "").length) || "/";
    return p.startsWith("/") && !p.startsWith("//") ? p + target.search : null;
  } catch { return null; }
}

/** Webhook ids already delivered, so a Supabase retry of a call that did go out doesn't send twice. */
const delivered = new Map<string, number>();
const remember = (id: string) => {
  const now = Date.now();
  for (const [k, until] of delivered) if (until < now) delivered.delete(k);
  delivered.set(id, now + 2 * TOLERANCE_SECONDS * 1000);
};

const fail = (res: Response, status: number, message: string) => res.status(status).json({ error: { http_code: status, message } });

/** Mounted before express.json() with a raw body parser: the signature covers the exact bytes. */
export async function sendEmailHook(req: Request, res: Response): Promise<void> {
  if (!emailRuntime().hookSecret || !emailConfigured()) { reportHookCall("refused: email not configured"); fail(res, 503, "Email sending is not configured."); return; }
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const id = req.get("webhook-id");
  if (!verifyHookSignature(body, id, req.get("webhook-timestamp"), req.get("webhook-signature"))) {
    req.log.warn("Send Email Hook: bad or missing signature");
    reportHookCall("refused: bad signature (check the hook secret)");
    fail(res, 401, "Invalid signature.");
    return;
  }
  if (delivered.has(id!)) { reportHookCall("ok (repeat)"); res.json({}); return; }
  let emails: OutgoingEmail[];
  try {
    const parsed = Payload.safeParse(JSON.parse(body.toString("utf8")));
    if (!parsed.success) throw new HookInputError("Unexpected payload.");
    emails = emailsFor(parsed.data);
  } catch (err) {
    req.log.error({ err }, "Send Email Hook: payload rejected");
    reportHookCall("refused: unexpected payload");
    fail(res, 400, err instanceof HookInputError ? err.message : "Unreadable payload.");
    return;
  }
  try {
    // Resend idempotency keys make a retry after a partial failure deliver each email once.
    for (const [i, email] of emails.entries()) await sendEmail(email, `supabase-hook:${id}:${i}`);
    remember(id!);
    reportHookCall("ok");
    res.json({});
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Send Email Hook: Resend failed");
    reportHookCall("failed: Resend refused or couldn't be reached");
    fail(res, err instanceof EmailError && err.retryable ? 503 : 500, "The email could not be sent. Please try again.");
  }
}
