import { eq, sql } from "drizzle-orm";
import { db, demoAuditTable, demoSettingsTable } from "@workspace/db";
import { EmailError, emailConfigured, emailRuntime, envEmailRuntime, onHookCall, parseFrom, resendApiUrl, sendEmail, setEmailRuntime } from "./email";
import { setEmailBranding, testEmail } from "./emailTemplates";
import { DemoInputError } from "./demoWorkspace";
import { logger } from "./logger";
import { scrub } from "./monitoring";
import { masterKey, open, seal, SecretBoxError } from "./secretBox";

/**
 * Admin Settings → Email: the Resend API key, sender, reply-to, signature, support address and the Send Email Hook
 * secret, plus health checks and a test email.
 *
 * - Stored on the `platform` row of demo_settings: `email_config` (plain settings) and `email_secrets` (each secret
 *   sealed with the server's master key, see secretBox.ts; only a hint such as `re_••••abcd` is ever sent to a browser).
 * - Precedence: a value saved here wins over the environment (RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO,
 *   SEND_EMAIL_HOOK_SECRET, SUPPORT_EMAIL); removing it falls back to the environment.
 * - Applied without a restart: saving reloads the settings in this process, and every process re-reads them each minute.
 */

type Source = "settings" | "environment" | "none";
type Config = { fromName?: string | null; fromAddress?: string | null; replyTo?: string | null; signature?: string | null; supportEmail?: string | null; updatedAt?: string; updatedBy?: string };
type SecretEntry = { sealed: string; hint: string; updatedAt: string; updatedBy: string };
const SECRETS = { resendApiKey: "Resend API key", hookSecret: "Send Email Hook secret" } as const;
export type SecretName = keyof typeof SECRETS;
type Secrets = Partial<Record<SecretName, SecretEntry>>;

const PLATFORM = "platform";
const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, "") || null;
const envSupport = () => process.env.SUPPORT_EMAIL?.trim() || null;

let config: Config = {};
let secrets: Secrets = {};
let opened: Partial<Record<SecretName, string>> = {};
let unreadable: Partial<Record<SecretName, boolean>> = {};
let hookSeenAt: Date | null = null;
let hookResult: string | null = null;

const formatFrom = (name: string | null, address: string) => (name ? `"${name.replace(/["\\\r\n<>]/g, "")}" <${address}>` : address);
const hintFor = (secret: string) => {
  const prefix = /^(re_|v1,whsec_)/.exec(secret)?.[1] ?? "";
  return `${prefix}••••${secret.slice(-4)}`;
};

/** What's in use right now, field by field, and where each value comes from. */
function effective() {
  const env = envEmailRuntime();
  const envFrom = parseFrom(env.from);
  const pick = <T>(saved: T | null | undefined, fromEnv: T | null | undefined): { value: T | null; source: Source } =>
    saved != null ? { value: saved, source: "settings" } : fromEnv != null ? { value: fromEnv, source: "environment" } : { value: null, source: "none" };
  const fromAddress = pick(config.fromAddress, envFrom?.address);
  const fromName = pick(config.fromName, envFrom?.name);
  return {
    apiKey: pick(opened.resendApiKey, env.apiKey),
    hookSecret: pick(opened.hookSecret, env.hookSecret),
    fromName, fromAddress,
    from: fromAddress.value ? formatFrom(fromName.value ?? "GrantApp", fromAddress.value) : null,
    replyTo: pick(config.replyTo, env.replyTo),
    signature: pick(config.signature, null),
    supportEmail: pick(config.supportEmail, envSupport()),
  };
}

function apply() {
  const e = effective();
  setEmailRuntime({ apiKey: e.apiKey.value, from: e.from, replyTo: e.replyTo.value, hookSecret: e.hookSecret.value });
  setEmailBranding({ signature: e.signature.value, supportEmail: e.supportEmail.value });
}

const asObject = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Reads the saved settings and puts them in use. Called at start-up, after each change, and every minute. */
export async function loadEmailSettings(): Promise<void> {
  const [row] = await db.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, PLATFORM));
  config = asObject(row?.emailConfig) as Config;
  secrets = asObject(row?.emailSecrets) as Secrets;
  hookSeenAt = row?.emailHookSeenAt ?? null;
  hookResult = row?.emailHookResult ?? null;
  const { key } = masterKey();
  opened = {}; unreadable = {};
  for (const name of Object.keys(SECRETS) as SecretName[]) {
    const entry = secrets[name];
    if (!entry?.sealed) continue;
    try {
      if (!key) throw new SecretBoxError("no master key");
      opened[name] = open(entry.sealed, name, key);
    } catch {
      unreadable[name] = true;
    }
  }
  if (Object.keys(unreadable).length) logger.error({ secrets: Object.keys(unreadable) }, "Saved email secrets can't be decrypted: the server's encryption key changed; enter them again in Admin Settings → Email");
  apply();
}

export function startEmailSettingsRefresh(intervalMs = 60_000) {
  onHookCall(recordHookCall);
  const tick = async () => {
    try { await loadEmailSettings(); } catch (err) { logger.error({ err }, "Reloading email settings failed"); }
    setTimeout(tick, intervalMs).unref();
  };
  setTimeout(tick, intervalMs).unref();
}

/** Remembers the Send Email Hook's last call; written to the database at most once a minute unless the outcome changes. */
function recordHookCall(result: string) {
  const changed = result !== hookResult;
  const stale = !hookSeenAt || Date.now() - hookSeenAt.getTime() > 60_000;
  hookSeenAt = new Date();
  hookResult = result;
  if (!changed && !stale) return;
  void db.update(demoSettingsTable).set({ emailHookSeenAt: hookSeenAt, emailHookResult: result }).where(eq(demoSettingsTable.id, PLATFORM))
    .catch((err) => logger.warn({ err: (err as Error).message }, "Couldn't record the Send Email Hook call"));
}

/* ---------- reading ---------- */

export function emailSettingsView() {
  const e = effective();
  const { key, problem } = masterKey();
  const secretView = (name: SecretName, v: { value: string | null; source: Source }) => ({
    set: v.value !== null,
    source: v.source,
    hint: v.value ? hintFor(v.value) : secrets[name]?.hint ?? null,
    updatedAt: secrets[name]?.updatedAt ?? null,
    updatedBy: secrets[name]?.updatedBy ?? null,
    unreadable: Boolean(unreadable[name]),
  });
  return {
    canStoreSecrets: Boolean(key),
    encryptionProblem: problem,
    apiKey: secretView("resendApiKey", e.apiKey),
    hookSecret: secretView("hookSecret", e.hookSecret),
    fromName: e.fromName, fromAddress: e.fromAddress, replyTo: e.replyTo, signature: e.signature, supportEmail: e.supportEmail,
    from: e.from,
    sending: emailConfigured(),
    appUrl,
    hookUrl: appUrl ? `${appUrl}/api/hooks/supabase/send-email` : null,
    updatedAt: config.updatedAt ?? null,
    updatedBy: config.updatedBy ?? null,
  };
}

/** For the Help Centre and other public places: the support address, if one is set. */
export const supportEmailAddress = () => effective().supportEmail.value;

/* ---------- saving ---------- */

export type EmailSettingsInput = {
  fromName?: string | null; fromAddress?: string | null; replyTo?: string | null; signature?: string | null; supportEmail?: string | null;
  apiKey?: string; hookSecret?: string;
};

const EMAIL = /^[^\s<>@",;]+@[^\s<>@",;]+\.[^\s<>@",;]+$/;
const LABELS = { fromName: "sender name", fromAddress: "sender address", replyTo: "reply-to address", signature: "signature", supportEmail: "support address" } as const;
type TextField = keyof typeof LABELS;

/** Validates and normalises one text setting: empty = remove it (fall back to the environment). */
function clean(field: TextField, raw: string | null | undefined): string | null {
  // eslint-disable-next-line no-control-regex
  const v = (raw ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").trim();
  if (!v) return null;
  switch (field) {
    case "fromName":
      if (v.length > 80 || /[\n"<>\\]/.test(v)) throw new DemoInputError("The sender name can be up to 80 characters, on one line, without quotes or < >.");
      return v;
    case "signature": {
      if (v.length > 600) throw new DemoInputError("The signature can be up to 600 characters.");
      const lines = v.split("\n").map((l) => l.trimEnd());
      if (lines.length > 10) throw new DemoInputError("The signature can be up to 10 lines.");
      return lines.join("\n");
    }
    default:
      if (v.length > 254 || !EMAIL.test(v)) throw new DemoInputError(`Enter the ${LABELS[field]} as an email address, like name@example.org.`);
      return v.toLowerCase();
  }
}

function cleanSecret(name: SecretName, raw: string): string {
  const v = raw.trim();
  if (name === "resendApiKey" && !/^re_[A-Za-z0-9_-]{8,200}$/.test(v)) throw new DemoInputError("That doesn't look like a Resend API key: it starts with re_ (Resend → API Keys).");
  if (name === "hookSecret") {
    const ok = /^v1,whsec_[A-Za-z0-9+/=]{20,200}$/.test(v) && Buffer.from(v.slice("v1,whsec_".length), "base64").length >= 16;
    if (!ok) throw new DemoInputError("That doesn't look like a Send Email Hook secret: it starts with v1,whsec_ (Supabase → Authentication → Hooks).");
  }
  return v;
}

export async function saveEmailSettings(input: EmailSettingsInput, actor: string) {
  const textChanges = (Object.keys(LABELS) as TextField[]).filter((f) => input[f] !== undefined).map((f) => [f, clean(f, input[f])] as const);
  const secretChanges = ([["resendApiKey", input.apiKey], ["hookSecret", input.hookSecret]] as const)
    .filter(([, v]) => v !== undefined && v.trim() !== "").map(([n, v]) => [n, cleanSecret(n, v!)] as const);
  const { key, problem } = masterKey();
  if (secretChanges.length && !key) throw new DemoInputError(`Secrets can't be saved yet: ${problem}`);

  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, PLATFORM)).for("update");
    const before = asObject(row?.emailConfig) as Config;
    const next: Config = { ...before };
    const changed: string[] = [];
    for (const [f, v] of textChanges) if ((before[f] ?? null) !== v) { next[f] = v; changed.push(LABELS[f]); }
    const sealedNext: Secrets = { ...(asObject(row?.emailSecrets) as Secrets) };
    const audits: string[] = [];
    const now = new Date().toISOString();
    for (const [name, value] of secretChanges) {
      audits.push(`${SECRETS[name]} ${sealedNext[name] ? "replaced" : "saved"} in Settings`);
      sealedNext[name] = { sealed: seal(value, name, key!), hint: hintFor(value), updatedAt: now, updatedBy: actor };
    }
    if (changed.length) { next.updatedAt = now; next.updatedBy = actor; audits.push(`Email settings updated: ${changed.join(", ")}`); }
    if (!audits.length) return;
    await tx.update(demoSettingsTable).set({ emailConfig: next, emailSecrets: sealedNext }).where(eq(demoSettingsTable.id, PLATFORM));
    for (const action of audits) await tx.insert(demoAuditTable).values({ actor, action });
  });
  await loadEmailSettings();
  return emailSettingsView();
}

export async function removeEmailSecret(name: SecretName, actor: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(demoSettingsTable).where(eq(demoSettingsTable.id, PLATFORM)).for("update");
    const current = { ...(asObject(row?.emailSecrets) as Secrets) };
    if (!current[name]) return;
    delete current[name];
    await tx.update(demoSettingsTable).set({ emailSecrets: current }).where(eq(demoSettingsTable.id, PLATFORM));
    await tx.insert(demoAuditTable).values({ actor, action: `${SECRETS[name]} removed from Settings` });
  });
  await loadEmailSettings();
  return emailSettingsView();
}

/* ---------- health checks ---------- */

type Status = "ok" | "warn" | "fail" | "off";
type Check = { id: string; label: string; status: Status; detail: string };
type DomainRecord = { record: string; type: string; name: string; status: string };

async function resend(path: string, apiKey: string): Promise<{ status: number; body: unknown; text: string }> {
  const res = await fetch(`${resendApiUrl}${path}`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8_000) });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}

const when = (d: Date | string) => new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export async function emailHealth() {
  const e = effective();
  const checks: Check[] = [];
  let domain: { name: string; status: string; records: DomainRecord[] } | null = null;

  // 1. Saved secrets readable
  const lost = (Object.keys(unreadable) as SecretName[]).map((n) => SECRETS[n]);
  if (lost.length) checks.push({ id: "secrets", label: "Saved secrets", status: "fail", detail: `${lost.join(" and ")} can't be decrypted: the server's encryption key changed or is missing. Enter ${lost.length > 1 ? "them" : "it"} again.` });

  // 2. API key, and the domain list it gives access to
  let domains: { id: string; name: string; status: string }[] | null = null;
  if (!e.apiKey.value) {
    checks.push({ id: "apiKey", label: "Resend API key", status: "off", detail: "No API key yet, so no email is sent. Create one in Resend → API Keys." });
  } else {
    try {
      const r = await resend("/domains", e.apiKey.value);
      if (r.status === 200) {
        domains = (asObject(r.body).data as typeof domains) ?? [];
        checks.push({ id: "apiKey", label: "Resend API key", status: "ok", detail: `Resend accepted the key (${e.apiKey.source === "settings" ? "saved in Settings" : "from the server environment"}).` });
      } else if ((r.status === 401 || r.status === 403) && /restricted/i.test(r.text)) {
        checks.push({ id: "apiKey", label: "Resend API key", status: "ok", detail: "Resend accepted the key. It's a sending-only key, so the domain can't be checked from here; check it in Resend → Domains, or use the test email." });
      } else if (r.status === 401 || r.status === 403) {
        checks.push({ id: "apiKey", label: "Resend API key", status: "fail", detail: "Resend refused the key: it's wrong or was deleted. Create a new one in Resend → API Keys." });
      } else {
        checks.push({ id: "apiKey", label: "Resend API key", status: "warn", detail: `Resend answered ${r.status}; try again in a minute.` });
      }
    } catch (err) {
      checks.push({ id: "apiKey", label: "Resend API key", status: "fail", detail: `Resend couldn't be reached: ${scrub((err as Error).message, 120)}` });
    }
  }

  // 3. Sender address on a verified domain
  const address = e.fromAddress.value;
  if (!address) {
    checks.push({ id: "sender", label: "Sender address", status: "off", detail: "No sender address yet. Use an address on a domain you verified in Resend." });
  } else if (!domains) {
    checks.push({ id: "sender", label: "Sender address", status: e.apiKey.value ? "warn" : "off", detail: `${address}: the domain couldn't be checked${e.apiKey.value ? "" : " without an API key"}.` });
  } else {
    const host = address.split("@")[1].toLowerCase();
    const match = domains.find((d) => d.name.toLowerCase() === host);
    if (!match) {
      const names = domains.map((d) => d.name).join(", ");
      checks.push({ id: "sender", label: "Sender address", status: "fail", detail: `${host} isn't on this Resend account${names ? ` (it has: ${names})` : " (it has no domains yet)"}. Add it in Resend → Domains, or use an address on a verified domain.` });
    } else {
      let records: DomainRecord[] = [];
      try {
        const r = await resend(`/domains/${encodeURIComponent(match.id)}`, e.apiKey.value!);
        if (r.status === 200) records = ((asObject(r.body).records as DomainRecord[]) ?? []).map((x) => ({ record: String(x.record), type: String(x.type), name: String(x.name), status: String(x.status) }));
      } catch { /* the domain status alone is enough */ }
      domain = { name: match.name, status: match.status, records };
      const verified = match.status === "verified";
      const pending = records.filter((x) => x.status !== "verified").map((x) => `${x.record} (${x.type} ${x.name})`);
      checks.push({
        id: "sender", label: "Sender address", status: verified ? "ok" : match.status === "failed" ? "fail" : "warn",
        detail: verified ? `${address} is on ${match.name}, verified in Resend.`
          : `${match.name} is ${match.status.replace(/_/g, " ")} in Resend${pending.length ? `; waiting for: ${pending.join(", ")}` : ""}. Emails from ${address} are refused until it's verified.`,
      });
    }
  }

  // 4. Links in emails
  checks.push(appUrl
    ? { id: "appUrl", label: "Links in emails", status: "ok", detail: `Links open ${appUrl}.` }
    : { id: "appUrl", label: "Links in emails", status: "fail", detail: "APP_URL isn't set on the server, so notification emails aren't sent and sign-in links fall back to Supabase." });

  // 5. Supabase Send Email Hook
  if (!e.hookSecret.value) {
    checks.push({ id: "hook", label: "Supabase sign-in emails", status: "off", detail: "No hook secret: Supabase sends sign-up and password emails itself (a few per hour at most). To send them through Resend, set up the Send Email Hook." });
  } else if (!hookSeenAt) {
    checks.push({ id: "hook", label: "Supabase sign-in emails", status: "warn", detail: "Secret saved, but Supabase hasn't called the hook yet. In Supabase → Authentication → Hooks → Send Email, choose HTTPS and paste the hook URL, then try a password reset." });
  } else {
    const ok = hookResult?.startsWith("ok") ?? false;
    checks.push({ id: "hook", label: "Supabase sign-in emails", status: ok ? "ok" : "fail", detail: `Last call from Supabase ${when(hookSeenAt)}: ${hookResult ?? "unknown"}.` });
  }

  // 6. Notification outbox
  const { rows: [o] } = await db.execute<{ waiting: number; retrying: number; failed: number; sent: number; last_sent: string | null; last_error: string | null; last_error_at: string | null }>(sql`
    with eligible as (
      select n.* from demo_notifications n join demo_profiles p on p.id = n.profile_id
      where p.auth_user_id is not null and coalesce((p.permissions ->> 'emailOverride')::boolean, (p.permissions ->> 'emailNotifications')::boolean, false)
    )
    select
      (select count(*)::int from eligible where emailed_at is null and email_attempts < 5 and created_at > now() - interval '24 hours') as waiting,
      (select count(*)::int from eligible where emailed_at is null and email_attempts between 1 and 4 and created_at > now() - interval '24 hours') as retrying,
      (select count(*)::int from eligible where emailed_at is null and email_attempts > 0 and (email_attempts >= 5 or created_at <= now() - interval '24 hours') and created_at > now() - interval '7 days') as failed,
      (select count(*)::int from demo_notifications where emailed_at > now() - interval '24 hours') as sent,
      (select max(emailed_at)::text from demo_notifications) as last_sent,
      (select email_last_error from demo_notifications where email_last_error is not null and emailed_at is null order by created_at desc limit 1) as last_error,
      (select created_at::text from demo_notifications where email_last_error is not null and emailed_at is null order by created_at desc limit 1) as last_error_at`);
  const outbox = { waiting: o.waiting, retrying: o.retrying, failed: o.failed, sentLast24h: o.sent, lastSentAt: o.last_sent ? new Date(o.last_sent).toISOString() : null, lastError: o.last_error, lastErrorAt: o.last_error_at ? new Date(o.last_error_at).toISOString() : null };
  checks.push({
    id: "outbox", label: "Notification emails",
    status: o.failed ? "fail" : o.retrying ? "warn" : emailConfigured() ? "ok" : "off",
    detail: o.failed ? `${o.failed} email${o.failed > 1 ? "s" : ""} gave up in the last 7 days.${o.last_error ? ` Last error: ${o.last_error}` : ""}`
      : o.retrying ? `${o.retrying} email${o.retrying > 1 ? "s are" : " is"} being retried.${o.last_error ? ` Last error: ${o.last_error}` : ""}`
      : emailConfigured() ? `${o.sent} sent in the last 24 hours${o.last_sent ? `; last one ${when(o.last_sent)}` : ""}. Nothing waiting.`
      : "Off until an API key and sender address are set.",
  });

  return { checkedAt: new Date().toISOString(), checks, domain, outbox };
}

/* ---------- test email ---------- */

export async function sendTestEmail(to: string, actor: string) {
  const address = clean("supportEmail", to); // same address rules
  if (!address) throw new DemoInputError("Enter the address to send the test email to.");
  const r = emailRuntime();
  if (!r.apiKey || !r.from) return { ok: false, to: address, id: null, message: "Email isn't set up yet: save a Resend API key and a sender address first." };
  try {
    const id = await sendEmail(testEmail(address, r.from, actor));
    await db.insert(demoAuditTable).values({ actor, action: `Test email sent to ${address}` });
    return { ok: true, to: address, id: id || null, message: `Sent. Resend accepted it${id ? ` (id ${id})` : ""}; it should arrive within a minute.` };
  } catch (err) {
    const msg = err instanceof EmailError ? err.message : "The email could not be sent.";
    return { ok: false, to: address, id: null, message: scrub(msg, 300) };
  }
}
