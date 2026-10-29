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

type Pending = { id: string; message: string; link: string | null; email: string; name: string };

/** Sends up to `limit` pending notification emails; returns how many went out. Rows are claimed with SKIP LOCKED. */
export async function sendPendingNotificationEmails(limit = 20): Promise<number> {
  if (!emailConfigured || !appUrl) return 0;
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute<Pending>(sql`
      select n.id, n.message, n.link, p.email, p.name
      from demo_notifications n join demo_profiles p on p.id = n.profile_id
      where n.emailed_at is null and n.email_attempts < ${MAX_ATTEMPTS} and n.created_at > now() - interval '24 hours'
        and p.auth_user_id is not null and coalesce((p.permissions ->> 'emailNotifications')::boolean, false)
      order by n.created_at
      limit ${limit}
      for update of n skip locked`);
    let sent = 0;
    for (const row of rows) {
      const url = `${appUrl}${row.link?.startsWith("/") ? row.link : "/"}`;
      try {
        await sendEmail(notificationEmail(row.email, row.name, row.message, url), `notification:${row.id}`);
        await tx.execute(sql`update demo_notifications set emailed_at = now(), email_attempts = email_attempts + 1 where id = ${row.id}`);
        sent++;
      } catch (err) {
        // A permanent refusal (bad address, unverified domain) isn't retried.
        const attempts = err instanceof EmailError && !err.retryable ? sql`${MAX_ATTEMPTS}` : sql`email_attempts + 1`;
        await tx.execute(sql`update demo_notifications set email_attempts = ${attempts} where id = ${row.id}`);
        logger.warn({ notification: row.id, err: (err as Error).message }, "Notification email failed");
      }
    }
    return sent;
  });
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
