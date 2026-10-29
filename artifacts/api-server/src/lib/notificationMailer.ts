import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { EmailError, emailConfigured, sendEmail } from "./email";
import { notificationEmail } from "./emailTemplates";
import { logger } from "./logger";

/**
 * Emails in-app notifications (an outbox): notifyUser() only writes the row inside the business transaction, and this
 * worker sends it afterwards, so a rolled-back action never emails and a slow email never holds up the action.
 * Only signed-up users (not the sample profiles) with email notifications on get email; a row is tried up to 5 times
 * and only within 24 hours of being created. APP_URL is the public web address used for the "Open GrantApp" link.
 */
const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, "");
const MAX_ATTEMPTS = 5;

type Claimed = { id: string; message: string; link: string | null; email: string; name: string };

/**
 * Sends up to `limit` pending notification emails; returns how many went out. Rows are claimed in one short statement
 * (SKIP LOCKED plus a two-minute lease, so several servers never take the same row and a crashed send is retried), and the
 * emails go out with no transaction or lock held. The attempt is counted at claim time; Resend idempotency keys stop a
 * retried row from being delivered twice.
 */
export async function sendPendingNotificationEmails(limit = 20): Promise<number> {
  if (!emailConfigured || !appUrl) return 0;
  const { rows } = await db.execute<Claimed>(sql`
    with due as (
      select n.id from demo_notifications n join demo_profiles p on p.id = n.profile_id
      where n.emailed_at is null and n.email_attempts < ${MAX_ATTEMPTS} and n.created_at > now() - interval '24 hours'
        and (n.email_claimed_until is null or n.email_claimed_until < now())
        and p.auth_user_id is not null and coalesce((p.permissions ->> 'emailNotifications')::boolean, false)
      order by n.created_at
      limit ${limit}
      for update of n skip locked
    ), claimed as (
      update demo_notifications d set email_claimed_until = now() + interval '2 minutes', email_attempts = d.email_attempts + 1
      from due where d.id = due.id
      returning d.id, d.message, d.link, d.profile_id
    )
    select c.id, c.message, c.link, p.email, p.name from claimed c join demo_profiles p on p.id = c.profile_id`);
  let sent = 0;
  for (const row of rows) {
    const url = `${appUrl}${row.link?.startsWith("/") ? row.link : "/"}`;
    try {
      await sendEmail(notificationEmail(row.email, row.name, row.message, url), `notification:${row.id}`);
      await db.execute(sql`update demo_notifications set emailed_at = now(), email_claimed_until = null where id = ${row.id}`);
      sent++;
    } catch (err) {
      // A permanent refusal (bad address, unverified domain) isn't retried; otherwise try again after a minute.
      const giveUp = err instanceof EmailError && !err.retryable;
      await db.execute(giveUp
        ? sql`update demo_notifications set email_attempts = ${MAX_ATTEMPTS}, email_claimed_until = null where id = ${row.id}`
        : sql`update demo_notifications set email_claimed_until = now() + interval '1 minute' where id = ${row.id}`);
      logger.warn({ notification: row.id, err: (err as Error).message }, "Notification email failed");
    }
  }
  return sent;
}

export function startNotificationMailer(intervalMs = 15_000) {
  if (!emailConfigured || !appUrl) {
    logger.warn("Notification emails are off: set RESEND_API_KEY, EMAIL_FROM and APP_URL");
    return;
  }
  const tick = async () => {
    try { await sendPendingNotificationEmails(); } catch (err) { logger.error({ err }, "Notification mailer failed"); }
    setTimeout(tick, intervalMs).unref();
  };
  setTimeout(tick, 2_000).unref();
}
