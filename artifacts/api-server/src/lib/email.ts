import { logger } from "./logger";

/**
 * Outgoing email through Resend (all mail: Supabase Auth emails via the Send Email Hook and app notifications).
 * RESEND_API_KEY and EMAIL_FROM (e.g. "GrantApp <no-reply@futurenestfund.org>", on a domain verified in Resend)
 * are required; RESEND_API_URL only exists so tests can point at a local stand-in.
 */
const apiKey = process.env.RESEND_API_KEY?.trim();
const from = process.env.EMAIL_FROM?.trim();
const apiUrl = (process.env.RESEND_API_URL?.trim() || "https://api.resend.com").replace(/\/+$/, "");

export const emailConfigured = Boolean(apiKey && from);
if (!emailConfigured) logger.warn("Email is off: set RESEND_API_KEY and EMAIL_FROM to send auth and notification emails");

export type OutgoingEmail = { to: string; subject: string; html: string; text: string };

export class EmailError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

/** Sends one email. `idempotencyKey` makes a retried send (same key) deliver only once on Resend's side. */
export async function sendEmail(email: OutgoingEmail, idempotencyKey?: string): Promise<string> {
  if (!emailConfigured) throw new EmailError("Email is not configured.", false);
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
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
