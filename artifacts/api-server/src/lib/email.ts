import { logger } from "./logger";

/**
 * Outgoing email through Resend (all mail: Supabase Auth emails via the Send Email Hook and app notifications).
 *
 * The settings in use can change while the server runs: emailSettings.ts loads what an administrator saved in Admin
 * Settings → Email and calls setEmailRuntime(); anything not set there falls back to the environment (RESEND_API_KEY,
 * EMAIL_FROM like "GrantApp <no-reply@futurenestfund.org>" on a domain verified in Resend, SEND_EMAIL_HOOK_SECRET).
 * This module never touches the database, so it stays testable on its own. RESEND_API_URL only exists so tests can point
 * at a local stand-in.
 */
export const resendApiUrl = (process.env.RESEND_API_URL?.trim() || "https://api.resend.com").replace(/\/+$/, "");

export type EmailRuntime = {
  apiKey: string | null;
  /** Full From header, e.g. `Future Nest Fund <no-reply@mail.futurenestfund.org>`. */
  from: string | null;
  replyTo: string | null;
  /** The Send Email Hook secret as given by Supabase (`v1,whsec_…`). */
  hookSecret: string | null;
};

const env = (name: string) => process.env[name]?.trim() || null;
export const envEmailRuntime = (): EmailRuntime => ({
  apiKey: env("RESEND_API_KEY"), from: env("EMAIL_FROM"), replyTo: env("EMAIL_REPLY_TO"), hookSecret: env("SEND_EMAIL_HOOK_SECRET"),
});

let runtime: EmailRuntime = envEmailRuntime();
if (!runtime.apiKey || !runtime.from) logger.warn("Email is off until a Resend API key and sender address are set (Admin Settings → Email, or RESEND_API_KEY and EMAIL_FROM)");

export const emailRuntime = (): Readonly<EmailRuntime> => runtime;
export function setEmailRuntime(next: EmailRuntime) { runtime = next; }
/** True when an email can be sent at all: a key and a sender address. */
export const emailConfigured = () => Boolean(runtime.apiKey && runtime.from);

/** Called by the Send Email Hook on every signed call, so Admin Settings can show when Supabase last reached us. */
let hookListener: ((result: string) => void) | null = null;
export function onHookCall(listener: (result: string) => void) { hookListener = listener; }
export function reportHookCall(result: string) { try { hookListener?.(result); } catch { /* never break the hook */ } }

/** `Name <address>` or a bare address → its parts. */
export function parseFrom(raw: string | null | undefined): { name: string | null; address: string } | null {
  const v = raw?.trim();
  if (!v) return null;
  const m = /^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(v);
  if (m) return { name: m[1].trim() || null, address: m[2] };
  return /^[^\s<>@]+@[^\s<>@]+$/.test(v) ? { name: null, address: v } : null;
}
export type OutgoingEmail = { to: string; subject: string; html: string; text: string };

export class EmailError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

/**
 * Sends one email. `idempotencyKey` makes a retried send (same key) deliver only once on Resend's side.
 * `override` sends with other settings (the test email can try a key before it's saved); otherwise the current ones.
 */
export async function sendEmail(email: OutgoingEmail, idempotencyKey?: string, override?: Partial<EmailRuntime>): Promise<string> {
  const r = { ...runtime, ...override };
  if (!r.apiKey || !r.from) throw new EmailError("Email is not configured.", false);
  let res: Response;
  try {
    res = await fetch(`${resendApiUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${r.apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({ from: r.from, to: [email.to], ...(r.replyTo ? { reply_to: r.replyTo } : {}), subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new EmailError(`Resend could not be reached: ${(err as Error).message}`, true);
  }
  const body = await res.text();
  if (!res.ok) {
    // 429 and 5xx are worth retrying; other 4xx (bad key, unverified domain, invalid address) are not.
    throw new EmailError(`Resend refused the email (${res.status}): ${body.slice(0, 300)}`, res.status === 429 || res.status >= 500);
  }
  try { return (JSON.parse(body) as { id?: string }).id ?? ""; } catch { return ""; }
}
