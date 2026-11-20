import { randomUUID } from "node:crypto";
import { Resolver } from "node:dns/promises";
import type { Request, Response } from "express";
import { and, eq, ilike } from "drizzle-orm";
import { db, demoMailMailboxesTable, demoMailMessagesTable } from "@workspace/db";
import { emailRuntime } from "./email";
import { inboundSecret, inboundSecretView, mailDomainConfig, mailWebhookConfig, saveMailConfig } from "./emailSettings";
import { hookKey, verifyHookSignature } from "./sendEmailHook";
import { inboundStats, listMailboxes, mailboxSignature, queueInbound } from "./mail";
import { MailInputError, formatAddress } from "./mailRules";
import {
  ResendError, createDomain, createWebhook, deleteWebhook, enableReceiving, getDomain, listDomains, listWebhooks, sendMailOut, verifyDomain, type ResendDomain, type ResendRecord,
} from "./resendApi";
import { logger } from "./logger";
import { scrub } from "./monitoring";

/**
 * Admin → Settings → Email, the Mail box part (Phase 14, email.md §4): connect the domain in Resend (sending and
 * receiving), compare its DNS records with what's really published, create the webhook that brings received mail in,
 * and test the whole loop. Uses a full-access Resend key (decision Q14).
 */

const appUrl = process.env.APP_URL?.trim().replace(/\/+$/, "") || null;
export const INBOUND_PATH = "/api/hooks/resend/inbound";
export const WEBHOOK_EVENTS = ["email.received", "email.delivered", "email.bounced", "email.complained", "email.failed", "email.delivery_delayed"];
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const REGIONS = ["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"];

type Status = "ok" | "warn" | "fail" | "off";
type Check = { id: string; label: string; status: Status; detail: string };

const friendly = (err: unknown) => (err instanceof ResendError || err instanceof MailInputError ? err.message : scrub((err as Error).message, 200));

/* ------------------------------------------------------------------ the overview */

export async function mailSetupView() {
  const domain = mailDomainConfig();
  const webhook = mailWebhookConfig();
  const apiKey = emailRuntime().apiKey;
  let keyAccess: "full" | "sending" | "invalid" | "missing" | "unreachable" = apiKey ? "full" : "missing";
  let resendDomain: ResendDomain | null = null;
  let domainError: string | null = null;
  if (apiKey) {
    try {
      if (domain) resendDomain = await getDomain(domain.id);
      else await listDomains();
    } catch (err) {
      if (err instanceof ResendError && err.restricted) keyAccess = "sending";
      else if (err instanceof ResendError && (err.status === 401 || err.status === 403)) keyAccess = "invalid";
      else if (err instanceof ResendError && err.status === 404 && domain) domainError = `${domain.name} is no longer on this Resend account. Add it again.`;
      else { keyAccess = err instanceof ResendError && err.status === 0 ? "unreachable" : keyAccess; domainError = friendly(err); }
    }
  }
  return {
    keyAccess,
    appUrl,
    inboundUrl: appUrl ? `${appUrl}${INBOUND_PATH}` : null,
    domain: domain ? { name: domain.name, region: domain.region, addedAt: domain.addedAt, addedBy: domain.addedBy } : null,
    resend: resendDomain ? { status: resendDomain.status, sending: resendDomain.sending, receiving: resendDomain.receiving, records: resendDomain.records } : null,
    domainError,
    webhook: webhook ? { endpoint: webhook.endpoint, createdAt: webhook.createdAt, createdBy: webhook.createdBy } : null,
    webhookSecret: inboundSecretView(),
    inbound: await inboundStats(),
    mailboxes: await listMailboxes(),
    regions: REGIONS,
    dailyLimit: Number(process.env.RESEND_DAILY_LIMIT ?? 100),
  };
}

/* ------------------------------------------------------------------ domain */

export async function connectDomain(input: { name?: unknown; region?: unknown }, actor: string) {
  const name = String(input.name ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!DOMAIN.test(name)) throw new MailInputError("Enter the domain only, like futurenestfund.org.");
  const region = REGIONS.includes(String(input.region)) ? String(input.region) : "eu-west-1";
  let d: ResendDomain;
  try {
    const existing = (await listDomains()).find((x) => x.name === name);
    if (existing) {
      d = await getDomain(existing.id);
      if (d.receiving !== "enabled") { await enableReceiving(d.id); d = await getDomain(d.id); }
    } else d = await createDomain(name, region);
  } catch (err) {
    throw new MailInputError(friendly(err));
  }
  const before = mailDomainConfig();
  await saveMailConfig({ mailDomain: { id: d.id, name: d.name, region: d.region ?? region, addedAt: new Date().toISOString(), addedBy: actor } }, actor,
    [before && before.name !== d.name ? `Mail domain changed from ${before.name} to ${d.name}` : `Mail domain ${d.name} connected (sending and receiving)`]);
  return mailSetupView();
}

export async function verifyMailDomain(actor: string) {
  const d = mailDomainConfig();
  if (!d) throw new MailInputError("Add your domain first.");
  try { await verifyDomain(d.id); } catch (err) { throw new MailInputError(friendly(err)); }
  logger.info({ actor, domain: d.name }, "Mail: domain verification requested");
  return mailSetupView();
}

export async function forgetDomain(actor: string) {
  const d = mailDomainConfig();
  if (!d) return mailSetupView();
  await saveMailConfig({ mailDomain: null }, actor, [`Mail domain ${d.name} removed from Settings (still on the Resend account)`]);
  return mailSetupView();
}

/* ------------------------------------------------------------------ DNS health */

const fqdn = (name: string, domain: string) => (!name || name === "@" || name === domain ? domain : name.endsWith(`.${domain}`) ? name : `${name}.${domain}`);
const norm = (s: string) => s.trim().replace(/^"|"$/g, "").replace(/\.$/, "").toLowerCase();

/** Public resolvers, so the answer isn't a cached or local view. */
function resolver() {
  const r = new Resolver({ timeout: 4_000, tries: 2 });
  r.setServers((process.env["MAIL_DNS_SERVERS"]?.split(",").map((x) => x.trim()).filter(Boolean)) ?? ["1.1.1.1", "8.8.8.8"]);
  return r;
}

type DnsResult = { name: string; type: string; expected: string; found: string[]; status: Status; detail: string; resendStatus: string | null; record: string; priority: number | null };

async function lookup(r: Resolver, type: string, host: string): Promise<string[] | "nxdomain"> {
  try {
    if (type === "TXT") return (await r.resolveTxt(host)).map((parts) => parts.join(""));
    if (type === "MX") return (await r.resolveMx(host)).sort((a, b) => a.priority - b.priority).map((m) => `${m.priority} ${m.exchange}`);
    if (type === "CNAME") return await r.resolveCname(host);
    return [];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN") return "nxdomain";
    throw err;
  }
}

async function checkRecord(r: Resolver, rec: ResendRecord, domain: string): Promise<DnsResult> {
  const host = fqdn(rec.name, domain);
  const base = { name: host, type: rec.type, expected: rec.type === "MX" ? `${rec.priority ?? 10} ${rec.value}` : rec.value, resendStatus: rec.status, record: rec.record, priority: rec.priority };
  let found: string[] | "nxdomain";
  try { found = await lookup(r, rec.type, host); } catch (err) {
    return { ...base, found: [], status: "warn", detail: `Couldn't look it up right now (${(err as NodeJS.ErrnoException).code ?? "error"}). Try again in a minute.` };
  }
  const list = found === "nxdomain" ? [] : found;
  let match = false;
  if (rec.type === "MX") match = list.some((x) => norm(x.split(" ")[1] ?? "") === norm(rec.value));
  else if (rec.type === "TXT") match = list.some((x) => norm(x) === norm(rec.value) || (rec.record === "DKIM" && norm(x).replace(/\s/g, "") === norm(rec.value).replace(/\s/g, "")));
  else match = list.some((x) => norm(x) === norm(rec.value));
  if (match) return { ...base, found: list, status: rec.status === "verified" ? "ok" : "warn", detail: rec.status === "verified" ? "Published and verified by Resend." : "Published. Waiting for Resend to verify it (press Verify)." };
  if (!list.length) return { ...base, found: list, status: "fail", detail: "Not found in DNS yet. Add it at your DNS provider (changes can take a few minutes, sometimes hours)." };
  return { ...base, found: list, status: "fail", detail: "A different value is published. Replace it with the expected value." };
}

export async function dnsHealth() {
  const d = mailDomainConfig();
  if (!d) throw new MailInputError("Add your domain first.");
  let resendDomain: ResendDomain;
  try { resendDomain = await getDomain(d.id); } catch (err) { throw new MailInputError(friendly(err)); }
  const r = resolver();
  const records = await Promise.all(resendDomain.records.map((rec) => checkRecord(r, rec, d.name)));
  const checks: Check[] = [];

  // Other MX records on a host where Resend's receiving MX sits would compete for the mail.
  const receivingMx = resendDomain.records.filter((x) => x.type === "MX" && x.record !== "SPF");
  for (const rec of receivingMx) {
    const host = fqdn(rec.name, d.name);
    const found = await lookup(r, "MX", host).catch(() => [] as string[]);
    const others = found === "nxdomain" ? [] : found.filter((x) => norm(x.split(" ")[1] ?? "") !== norm(rec.value));
    if (others.length) checks.push({ id: "mx-conflict", label: "Other mail servers", status: "fail", detail: `${host} also has MX records for ${others.join(", ")}. Mail would be split between them: remove them, or receive on a subdomain.` });
  }

  // DMARC: not needed by Resend, but Gmail and Yahoo expect it.
  const dmarc = await lookup(r, "TXT", `_dmarc.${d.name}`).catch(() => [] as string[]);
  const dmarcValue = dmarc === "nxdomain" ? null : dmarc.find((x) => /^v=DMARC1/i.test(x)) ?? null;
  checks.push(dmarcValue
    ? { id: "dmarc", label: "DMARC", status: "ok", detail: `Published: ${dmarcValue}` }
    : { id: "dmarc", label: "DMARC", status: "warn", detail: `Not published. Add a TXT record at _dmarc.${d.name} with v=DMARC1; p=none; (start with p=none, tighten later). Gmail and Yahoo expect it.` });

  const failing = records.filter((x) => x.status === "fail").length;
  checks.unshift({
    id: "records", label: "Resend's records", status: failing ? "fail" : records.every((x) => x.status === "ok") ? "ok" : "warn",
    detail: failing ? `${failing} of ${records.length} records are missing or different.` : `All ${records.length} records are published${resendDomain.status === "verified" ? " and verified" : "; press Verify so Resend checks them"}.`,
  });
  return {
    checkedAt: new Date().toISOString(), domain: d.name, resendStatus: resendDomain.status, receiving: resendDomain.receiving, records, checks,
    dmarcSuggestion: `v=DMARC1; p=none; rua=mailto:dmarc@${d.name}`,
  };
}

/* ------------------------------------------------------------------ webhook */

export async function setupWebhook(actor: string) {
  // MAIL_ALLOW_HTTP_WEBHOOK=1 is for local tests against the Resend stand-in only.
  const httpOk = process.env["MAIL_ALLOW_HTTP_WEBHOOK"] === "1" && process.env.NODE_ENV !== "production";
  if (!appUrl || !(/^https:\/\//.test(appUrl) || (httpOk && /^http:\/\//.test(appUrl)))) throw new MailInputError("The server's APP_URL must be a public https address (e.g. https://access.futurenestfund.org) for Resend to reach it.");
  const endpoint = `${appUrl}${INBOUND_PATH}`;
  const audits: string[] = [];
  try {
    const hooks = await listWebhooks();
    // The signing secret is only shown when a webhook is made, so ours is made again.
    for (const h of hooks.filter((x) => x.endpoint === endpoint)) { await deleteWebhook(h.id); audits.push("Old Resend webhook replaced"); }
    const made = await createWebhook(endpoint, WEBHOOK_EVENTS);
    audits.push(`Resend webhook created for received mail (${endpoint})`);
    await saveMailConfig({ mailWebhook: { id: made.id, endpoint, createdAt: new Date().toISOString(), createdBy: actor }, inboundSecret: made.secret }, actor, audits);
  } catch (err) {
    if (err instanceof ResendError && /limit|maximum|plan/i.test(err.message)) {
      throw new MailInputError("Resend's plan allows no more webhooks. Delete an unused webhook in Resend → Webhooks, then try again.");
    }
    throw new MailInputError(friendly(err));
  }
  return mailSetupView();
}

export async function removeWebhook(actor: string) {
  const w = mailWebhookConfig();
  if (w) await deleteWebhook(w.id).catch((err) => logger.warn({ err: friendly(err) }, "Mail: deleting the Resend webhook failed"));
  await saveMailConfig({ mailWebhook: null, inboundSecret: null }, actor, ["Resend webhook for received mail removed"]);
  return mailSetupView();
}

/** Resend's webhook call: checked, queued, answered at once (mounted before express.json(); the signature covers the raw body). */
export async function mailInboundHook(req: Request, res: Response): Promise<void> {
  const secret = inboundSecret();
  if (!secret) { res.status(503).json({ error: "Receiving isn't set up." }); return; }
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const id = req.get("svix-id") ?? req.get("webhook-id");
  const ok = verifyHookSignature(body, id, req.get("svix-timestamp") ?? req.get("webhook-timestamp"), req.get("svix-signature") ?? req.get("webhook-signature"), hookKey(secret));
  if (!ok) { req.log.warn("Resend webhook: bad or missing signature"); res.status(401).json({ error: "Invalid signature." }); return; }
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    payload = parsed as Record<string, unknown>;
  } catch { res.status(400).json({ error: "Unreadable payload." }); return; }
  try {
    await queueInbound(id!.slice(0, 100), payload);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Resend webhook: couldn't queue the call");
    res.status(500).json({ error: "Try again." });
  }
}

/* ------------------------------------------------------------------ round-trip test */

/** Sends an email from a mailbox to itself; the browser then asks whether it has arrived. */
export async function startRoundTrip(mailboxId: string, actor: string) {
  const [box] = await db.select().from(demoMailMailboxesTable).where(eq(demoMailMailboxesTable.id, mailboxId));
  if (!box) throw new MailInputError("Choose a mailbox to test.");
  const token = randomUUID().slice(0, 8).toUpperCase();
  const sig = mailboxSignature(box);
  const subject = `Round-trip test ${token}`;
  try {
    await sendMailOut({
      from: formatAddress({ address: box.address, name: box.displayName }), to: [box.address], cc: [], bcc: [], subject,
      html: `<p>This is a test from Settings → Email, sent by ${actor}. If it arrives in the Mail box, sending and receiving both work.</p>${sig.html}`,
      text: `This is a test from Settings → Email, sent by ${actor}. If it arrives in the Mail box, sending and receiving both work.\n\n${sig.text}`,
      headers: {}, attachments: [],
    }, `roundtrip-${token}`);
  } catch (err) {
    throw new MailInputError(friendly(err));
  }
  return { token, mailboxId, sentAt: new Date().toISOString() };
}

export async function roundTripStatus(token: string, mailboxId: string) {
  if (!/^[A-F0-9]{8}$/.test(token)) throw new MailInputError("Unknown test.");
  const [m] = await db.select({ createdAt: demoMailMessagesTable.createdAt, threadId: demoMailMessagesTable.threadId }).from(demoMailMessagesTable)
    .where(and(eq(demoMailMessagesTable.mailboxId, mailboxId), eq(demoMailMessagesTable.direction, "in"), ilike(demoMailMessagesTable.subject, `%Round-trip test ${token}%`)));
  return { arrived: Boolean(m), receivedAt: m?.createdAt.toISOString() ?? null, threadId: m?.threadId ?? null };
}
