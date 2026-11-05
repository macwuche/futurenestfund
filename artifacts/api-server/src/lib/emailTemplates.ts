import type { OutgoingEmail } from "./email";

/** Every value placed in an email's HTML goes through this (names and messages come from users). */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * Set from Admin Settings → Email (emailSettings.ts): a plain-text signature added to every email, and the address
 * people can write to for help. Both are escaped like everything else.
 */
export type EmailBranding = { signature: string | null; supportEmail: string | null };
let branding: EmailBranding = { signature: null, supportEmail: null };
export function setEmailBranding(next: EmailBranding) { branding = next; }

type Block = { kind: "p"; text: string } | { kind: "button"; label: string; href: string } | { kind: "code"; code: string } | { kind: "small"; text: string }
  | { kind: "rows"; rows: [string, string][] };

/** One branded layout (table-based with inline styles, which is what email clients render reliably) plus plain text. */
function render(to: string, subject: string, heading: string, blocks: Block[]): OutgoingEmail {
  const html = blocks.map((b) => {
    switch (b.kind) {
      case "p": return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(b.text)}</p>`;
      case "small": return `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#64748B">${escapeHtml(b.text)}</p>`;
      case "code": return `<p style="margin:8px 0 20px;font-size:30px;font-weight:700;letter-spacing:6px;color:#0F172A;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(b.code)}</p>`;
      case "rows": return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid #E5E7EB;border-radius:12px">`
        + b.rows.map(([k, v], i) => `<tr><td style="padding:10px 14px;font-size:14px;color:#64748B${i ? ";border-top:1px solid #E5E7EB" : ""}">${escapeHtml(k)}</td>`
          + `<td align="right" style="padding:10px 14px;font-size:14px;font-weight:600;color:#0F172A${i ? ";border-top:1px solid #E5E7EB" : ""}">${escapeHtml(v)}</td></tr>`).join("")
        + `</table>`;
      case "button": return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 20px"><tr><td style="border-radius:999px;background:#1E3A8A">`
        + `<a href="${escapeHtml(b.href)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:999px">${escapeHtml(b.label)}</a></td></tr></table>`
        + `<p style="margin:0 0 16px;font-size:12px;line-height:1.5;color:#64748B">Button not working? Paste this link into your browser:<br><a href="${escapeHtml(b.href)}" style="color:#1E3A8A;word-break:break-all">${escapeHtml(b.href)}</a></p>`;
    }
  }).join("");
  const sig = branding.signature?.trim()
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #E5E7EB;font-size:14px;line-height:1.6;color:#334155" data-signature>${branding.signature.trim().split("\n").map(escapeHtml).join("<br>")}</p>`
    : "";
  const support = branding.supportEmail
    ? ` Questions? Write to <a href="mailto:${escapeHtml(branding.supportEmail)}" style="color:#1E3A8A">${escapeHtml(branding.supportEmail)}</a>.`
    : "";
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:#F3F4F6;font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif">`
    + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F3F4F6;padding:32px 16px"><tr><td align="center">`
    + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px">`
    + `<tr><td style="padding:0 4px 20px;font-size:22px;font-weight:700;color:#0F172A">GrantApp</td></tr>`
    + `<tr><td style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:16px;padding:28px">`
    + `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0F172A">${escapeHtml(heading)}</h1>${html}${sig}</td></tr>`
    + `<tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.5;color:#64748B">Sent by GrantApp to ${escapeHtml(to)}. If you didn't expect this email, you can ignore it.${support}</td></tr>`
    + `</table></td></tr></table></body></html>`;
  const text = [heading, "", ...blocks.map((b) => (b.kind === "button" ? `${b.label}: ${b.href}` : b.kind === "code" ? b.code : b.kind === "rows" ? b.rows.map(([k, v]) => `${k}: ${v}`).join("\n") : b.text)), "",
    ...(branding.signature?.trim() ? ["--", branding.signature.trim(), ""] : []),
    `Sent by GrantApp to ${to}. If you didn't expect this email, you can ignore it.${branding.supportEmail ? ` Questions? Write to ${branding.supportEmail}.` : ""}`].join("\n");
  return { to, subject, html: page, text };
}

const greeting = (name?: string) => (name ? `Hi ${name},` : "Hi,");

export type AuthEmailKind =
  | "signup" | "recovery" | "magiclink" | "invite" | "email_change_current" | "email_change_new" | "reauthentication" | "email"
  | "password_changed_notification" | "email_changed_notification" | "phone_changed_notification" | "identity_linked_notification"
  | "identity_unlinked_notification" | "mfa_factor_enrolled_notification" | "mfa_factor_unenrolled_notification";

/** The email for one Supabase Auth event. `link` is the verification URL, `code` the 6-digit code where one applies. */
export function authEmail(kind: AuthEmailKind, to: string, opts: { name?: string; link?: string; code?: string; newEmail?: string; oldEmail?: string }): OutgoingEmail {
  const hi = { kind: "p" as const, text: greeting(opts.name) };
  const notYou = (what: string): Block => ({ kind: "small", text: `If you didn't ${what}, reset your password from the sign-in page straight away and contact support.` });
  const button = (label: string): Block => ({ kind: "button", label, href: opts.link! });
  switch (kind) {
    case "signup": return render(to, "Confirm your GrantApp account", "Confirm your email", [hi,
      { kind: "p", text: "Thanks for creating a GrantApp account. Confirm your email address to start applying for grants." }, button("Confirm email"),
      { kind: "small", text: "The link works once. If you didn't create an account, ignore this email and nothing will happen." }]);
    case "recovery": return render(to, "Reset your GrantApp password", "Reset your password", [hi,
      { kind: "p", text: "We received a request to reset your password. Choose a new one with the button below." }, button("Choose a new password"),
      { kind: "small", text: "The link works once and expires after an hour. If you didn't ask for this, ignore this email: your password stays the same." }]);
    case "magiclink": return render(to, "Your GrantApp sign-in link", "Sign in to GrantApp", [hi,
      { kind: "p", text: "Use the button below to sign in. No password needed." }, button("Sign in"),
      { kind: "small", text: "The link works once. If you didn't ask to sign in, ignore this email." }]);
    case "invite": return render(to, "You've been invited to GrantApp", "You're invited", [hi,
      { kind: "p", text: "You've been invited to join GrantApp. Accept the invitation to set up your account." }, button("Accept invitation")]);
    case "email_change_current": return render(to, "Confirm your GrantApp email change", "Confirm your email change", [hi,
      { kind: "p", text: `We received a request to change your account's email from ${to} to ${opts.newEmail ?? "a new address"}. Confirm it from this address too.` },
      button("Confirm the change"), notYou("ask for this")]);
    case "email_change_new": return render(to, "Confirm your new GrantApp email", "Confirm your new email address", [hi,
      { kind: "p", text: `Confirm that ${to} should become the email address for your GrantApp account.` }, button("Confirm new email")]);
    case "reauthentication": return render(to, "Your GrantApp verification code", "Confirm it's you", [hi,
      { kind: "p", text: "Enter this code to confirm the change you're making:" }, { kind: "code", code: opts.code ?? "" }, notYou("request this code")]);
    case "email": return render(to, "Your GrantApp sign-in code", "Your sign-in code", [hi,
      { kind: "p", text: "Enter this code to sign in:" }, { kind: "code", code: opts.code ?? "" },
      { kind: "small", text: "If you didn't try to sign in, ignore this email." }]);
    case "password_changed_notification": return render(to, "Your GrantApp password was changed", "Your password was changed", [hi,
      { kind: "p", text: "The password for your GrantApp account was just changed." }, notYou("change it")]);
    case "email_changed_notification": return render(to, "Your GrantApp email was changed", "Your email address was changed", [hi,
      { kind: "p", text: `Your account's email address was changed${opts.oldEmail ? ` from ${opts.oldEmail}` : ""} to ${opts.newEmail ?? "a new address"}.` }, notYou("make this change")]);
    case "phone_changed_notification": return render(to, "Your GrantApp phone number was changed", "Your phone number was changed", [hi,
      { kind: "p", text: "The phone number on your GrantApp account was changed." }, notYou("make this change")]);
    case "identity_linked_notification": return render(to, "A sign-in method was added to your GrantApp account", "New sign-in method added", [hi,
      { kind: "p", text: "A new sign-in method was linked to your GrantApp account." }, notYou("add it")]);
    case "identity_unlinked_notification": return render(to, "A sign-in method was removed from your GrantApp account", "Sign-in method removed", [hi,
      { kind: "p", text: "A sign-in method was removed from your GrantApp account." }, notYou("remove it")]);
    case "mfa_factor_enrolled_notification": return render(to, "Two-factor authentication was turned on", "Two-factor authentication added", [hi,
      { kind: "p", text: "An authenticator app was added to your GrantApp account. You'll be asked for a code when you sign in." }, notYou("add it")]);
    case "mfa_factor_unenrolled_notification": return render(to, "Two-factor authentication was removed", "Two-factor authentication removed", [hi,
      { kind: "p", text: "An authenticator app was removed from your GrantApp account." }, notYou("remove it")]);
  }
}

/** An in-app notification sent as email too. `url` opens the related page. */
export function notificationEmail(to: string, name: string, message: string, url: string): OutgoingEmail {
  return render(to, `GrantApp: ${message.length > 90 ? `${message.slice(0, 87)}…` : message}`, "You have an update", [
    { kind: "p", text: greeting(name) }, { kind: "p", text: message }, { kind: "button", label: "Open GrantApp", href: url },
    { kind: "small", text: "You get these emails because email notifications are on for your account. Turn them off any time in Settings → Account." },
  ]);
}

/** Dedicated emails for deposit and withdrawal requests; the outbox picks one by `demo_notifications.email_kind`. */
export type MoneyEmailKind = "request_received" | "request_approved" | "request_declined";
export type MoneyEmailData = {
  request: "Deposit" | "Withdrawal"; amountCents: number; reference: string; date: string;
  /** Decline reason, or the optional note an administrator added when approving. */
  reason?: string;
  /** Payment method name (Phase 10) and, for withdrawals, the balance it's paid from. */
  method?: string; source?: "grant" | "deposit";
  /** The method's fee (9.3): deposits lose it from the amount; withdrawals pay it from the account balance. */
  feeCents?: number;
};
export const isMoneyEmailKind = (k: unknown): k is MoneyEmailKind => k === "request_received" || k === "request_approved" || k === "request_declined";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function moneyEmail(kind: MoneyEmailKind, to: string, name: string, d: MoneyEmailData, url: string): OutgoingEmail {
  const what = d.request.toLowerCase();
  const withdrawal = d.request === "Withdrawal";
  const balance = d.source === "deposit" ? "account balance" : "grant balance";
  const rows: [string, string][] = [["Amount", usd(d.amountCents)], ...(d.method ? [["Method", d.method] as [string, string]] : []),
    ...(withdrawal && d.source ? [["Paid from", `Your ${balance}`] as [string, string]] : []),
    ...(d.feeCents ? [["Fee", withdrawal ? `${usd(d.feeCents)}, from your account balance` : usd(d.feeCents)] as [string, string],
      [withdrawal ? "Total" : "You receive", usd(withdrawal ? d.amountCents + d.feeCents : d.amountCents - d.feeCents)] as [string, string]] : []),
    ["Reference", d.reference], ["Requested", d.date]];
  const button = { kind: "button" as const, label: withdrawal ? "View your withdrawals" : "View your deposits", href: url };
  const footer = { kind: "small" as const, text: "Questions? Reply to your administrator or visit the Help Centre in GrantApp. Never share your password with anyone, including our team." };
  switch (kind) {
    case "request_received": return render(to, `We received your ${what} request (${usd(d.amountCents)})`, `${d.request} request received`, [
      { kind: "p", text: greeting(name) },
      { kind: "p", text: withdrawal
        ? "Your withdrawal request has been placed. Our finance team will review it, and your funds will be released once it's approved. The amount is held from your available balance in the meantime."
        : "Your deposit request has been placed. Our finance team will review it, and the funds will be added to your account balance once it's approved." },
      { kind: "rows", rows: [...rows, ["Status", "Under review"]] },
      { kind: "p", text: "We'll email you again as soon as it has been reviewed." }, button, footer]);
    case "request_approved": return render(to, `Your ${what} of ${usd(d.amountCents)} was approved`, `${d.request} approved`, [
      { kind: "p", text: greeting(name) },
      { kind: "p", text: withdrawal
        ? `Good news: our finance team approved your withdrawal. The funds have been released from your ${balance}.`
        : "Good news: our finance team approved your deposit. The funds are now in your account balance." },
      { kind: "rows", rows: [...rows, ["Status", "Approved"], ...(d.reason ? [["Note", d.reason] as [string, string]] : [])] }, button, footer]);
    case "request_declined": return render(to, `Your ${what} request of ${usd(d.amountCents)} was declined`, `${d.request} declined`, [
      { kind: "p", text: greeting(name) },
      { kind: "p", text: `Our finance team declined your ${what} request. No money has moved${withdrawal ? ", and the held amount is available again" : ""}.` },
      { kind: "rows", rows: [...rows, ["Status", "Declined"], ["Reason", d.reason || "Not given"]] },
      { kind: "p", text: "You can submit a new request at any time." }, button, footer]);
  }
}

/** The "Send test email" button in Admin Settings → Email. */
export function testEmail(to: string, from: string, sentBy: string): OutgoingEmail {
  return render(to, "GrantApp: test email", "Your email settings work", [
    { kind: "p", text: "This is a test email from Admin Settings → Email. If you can read it, GrantApp can send email through Resend." },
    { kind: "rows", rows: [["Sender", from], ["Requested by", sentBy], ["Sent", new Date().toUTCString()]] },
    { kind: "small", text: "Check the sender name, the signature below and the footer: every email GrantApp sends looks like this." },
  ]);
}
