import { EmailError, emailRuntime, resendApiUrl } from "./email";

/**
 * The Resend API calls the Mail box and Settings → Email need beyond sending notifications (email.md §12):
 * domains (create with receiving on, read records, verify), the webhook, received emails and their attachments, and
 * sending with cc / bcc / attachments / threading headers. A full-access key is needed for domains and webhooks; a
 * sending-only key answers 401 "restricted" there (shown as such in Settings).
 */

export class ResendError extends Error {
  constructor(message: string, readonly status: number, readonly restricted = false) { super(message); }
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

export async function resendCall(method: string, path: string, body?: unknown, apiKey = emailRuntime().apiKey, timeoutMs = 10_000): Promise<Json> {
  if (!apiKey) throw new ResendError("No Resend API key is saved yet.", 0);
  let res: Response;
  try {
    res = await fetch(`${resendApiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ResendError(`Resend couldn't be reached: ${(err as Error).message}`, 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = String(asObj(json)["message"] ?? text).slice(0, 300);
    const restricted = (res.status === 401 || res.status === 403) && /restricted/i.test(text);
    throw new ResendError(restricted ? "This Resend key can only send email. Create a full-access key to manage domains and the webhook from here." : `Resend answered ${res.status}: ${msg}`, res.status, restricted);
  }
  return asObj(json);
}

/* ------------------------------------------------------------------ domains */

export type ResendRecord = { record: string; name: string; type: string; value: string; priority: number | null; status: string; ttl: string };
export type ResendDomain = { id: string; name: string; status: string; region: string | null; sending: string; receiving: string; records: ResendRecord[] };

function toDomain(o: Json): ResendDomain {
  const caps = asObj(o["capabilities"]);
  return {
    id: String(o["id"] ?? ""), name: String(o["name"] ?? "").toLowerCase(), status: String(o["status"] ?? "unknown"),
    region: o["region"] ? String(o["region"]) : null,
    sending: String(caps["sending"] ?? "enabled"), receiving: String(caps["receiving"] ?? "disabled"),
    records: (Array.isArray(o["records"]) ? o["records"] : []).map((r) => {
      const x = asObj(r);
      return {
        record: String(x["record"] ?? ""), name: String(x["name"] ?? ""), type: String(x["type"] ?? ""), value: String(x["value"] ?? ""),
        priority: x["priority"] == null ? null : Number(x["priority"]), status: String(x["status"] ?? "not_started"), ttl: String(x["ttl"] ?? "Auto"),
      };
    }),
  };
}

export async function listDomains(apiKey?: string): Promise<{ id: string; name: string; status: string }[]> {
  const r = await resendCall("GET", "/domains", undefined, apiKey);
  return (Array.isArray(r["data"]) ? r["data"] : []).map((d) => { const o = asObj(d); return { id: String(o["id"]), name: String(o["name"]).toLowerCase(), status: String(o["status"]) }; });
}
export const getDomain = async (id: string, apiKey?: string) => toDomain(await resendCall("GET", `/domains/${encodeURIComponent(id)}`, undefined, apiKey));
export const createDomain = async (name: string, region: string, apiKey?: string) =>
  toDomain(await resendCall("POST", "/domains", { name, region, capabilities: { sending: "enabled", receiving: "enabled" } }, apiKey));
export const enableReceiving = async (id: string, apiKey?: string) =>
  resendCall("PATCH", `/domains/${encodeURIComponent(id)}`, { capabilities: { sending: "enabled", receiving: "enabled" } }, apiKey);
export const verifyDomain = async (id: string, apiKey?: string) => resendCall("POST", `/domains/${encodeURIComponent(id)}/verify`, {}, apiKey);

/* ------------------------------------------------------------------ webhook */

export async function listWebhooks(apiKey?: string): Promise<{ id: string; endpoint: string; events: string[]; status: string }[]> {
  const r = await resendCall("GET", "/webhooks", undefined, apiKey);
  return (Array.isArray(r["data"]) ? r["data"] : []).map((w) => {
    const o = asObj(w);
    return { id: String(o["id"]), endpoint: String(o["endpoint"] ?? ""), events: Array.isArray(o["events"]) ? o["events"].map(String) : [], status: String(o["status"] ?? "enabled") };
  });
}
export async function createWebhook(endpoint: string, events: string[], apiKey?: string): Promise<{ id: string; secret: string }> {
  const r = await resendCall("POST", "/webhooks", { endpoint, events }, apiKey);
  const secret = String(r["signing_secret"] ?? "");
  if (!secret) throw new ResendError("Resend made the webhook but didn't return its signing secret.", 0);
  return { id: String(r["id"]), secret };
}
export const deleteWebhook = (id: string, apiKey?: string) => resendCall("DELETE", `/webhooks/${encodeURIComponent(id)}`, undefined, apiKey);

/* ------------------------------------------------------------------ received mail */

export type ReceivedEmail = {
  id: string; from: string; to: string[]; cc: string[]; bcc: string[]; replyTo: string[]; receivedFor: string[];
  subject: string; html: string | null; text: string | null; headers: Record<string, string>; messageId: string | null;
  authentication: unknown; createdAt: string | null;
  attachments: { id: string; filename: string; contentType: string; contentId: string | null; disposition: string | null; size: number }[];
};

const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []);

export async function getReceivedEmail(id: string): Promise<ReceivedEmail> {
  // cid: keeps inline images as references to attachments, which we store ourselves (no data: blobs in the HTML).
  const o = await resendCall("GET", `/emails/receiving/${encodeURIComponent(id)}?html_format=cid`, undefined, undefined, 20_000);
  const headers: Record<string, string> = {};
  const h = o["headers"];
  if (Array.isArray(h)) for (const x of h) { const r = asObj(x); if (r["name"]) headers[String(r["name"]).toLowerCase()] = String(r["value"] ?? ""); }
  else for (const [k, v] of Object.entries(asObj(h))) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  return {
    id: String(o["id"] ?? id), from: String(o["from"] ?? ""), to: list(o["to"]), cc: list(o["cc"]), bcc: list(o["bcc"]), replyTo: list(o["reply_to"]),
    receivedFor: list(o["received_for"]), subject: String(o["subject"] ?? ""), html: o["html"] == null ? null : String(o["html"]), text: o["text"] == null ? null : String(o["text"]),
    headers, messageId: o["message_id"] ? String(o["message_id"]) : headers["message-id"] ?? null, authentication: o["authentication"] ?? null,
    createdAt: o["created_at"] ? String(o["created_at"]) : null,
    attachments: (Array.isArray(o["attachments"]) ? o["attachments"] : []).map((a) => {
      const x = asObj(a);
      return { id: String(x["id"]), filename: String(x["filename"] ?? "attachment"), contentType: String(x["content_type"] ?? "application/octet-stream"),
        contentId: x["content_id"] ? String(x["content_id"]).replace(/^<|>$/g, "") : null, disposition: x["content_disposition"] ? String(x["content_disposition"]) : null, size: Number(x["size"] ?? 0) };
    }),
  };
}

/** Download links for a received email's attachments (each valid for an hour). */
export async function receivedAttachmentLinks(emailId: string): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const r = await resendCall("GET", `/emails/receiving/${encodeURIComponent(emailId)}/attachments?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`, undefined, undefined, 20_000);
    const data = Array.isArray(r["data"]) ? r["data"] : [];
    for (const a of data) { const x = asObj(a); if (x["id"] && x["download_url"]) links.set(String(x["id"]), String(x["download_url"])); }
    if (!r["has_more"] || !data.length) break;
    after = String(asObj(data[data.length - 1])["id"]);
  }
  return links;
}

/** Downloads one attachment (Resend's signed CDN link), refusing more than `maxBytes`. */
export async function downloadAttachment(url: string, maxBytes: number): Promise<Buffer | "too-large"> {
  const u = new URL(url);
  // Resend's links are https on its CDN; the local stand-in in tests is http on localhost.
  if (u.protocol !== "https:" && !(process.env["RESEND_API_URL"] && u.hostname === "localhost")) throw new ResendError("Unexpected attachment link.", 0);
  const res = await fetch(u, { signal: AbortSignal.timeout(60_000), redirect: "error" });
  if (!res.ok || !res.body) throw new ResendError(`The attachment couldn't be downloaded (${res.status}).`, res.status);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) { await res.body.cancel(); return "too-large"; }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > maxBytes) return "too-large";
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/* ------------------------------------------------------------------ sending from a mailbox */

export type MailOut = {
  from: string; to: string[]; cc: string[]; bcc: string[]; replyTo?: string[]; subject: string; html: string; text: string;
  headers: Record<string, string>; attachments: { filename: string; content: Buffer; contentType: string }[];
};

/** Sends one email from a mailbox. Errors say whether a retry could help. */
export async function sendMailOut(m: MailOut, idempotencyKey: string): Promise<string> {
  const apiKey = emailRuntime().apiKey;
  if (!apiKey) throw new EmailError("Email isn't set up yet: save a Resend API key in Settings → Email.", false);
  let res: Response;
  try {
    res = await fetch(`${resendApiUrl}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.slice(0, 256) },
      body: JSON.stringify({
        from: m.from, to: m.to, ...(m.cc.length ? { cc: m.cc } : {}), ...(m.bcc.length ? { bcc: m.bcc } : {}), ...(m.replyTo?.length ? { reply_to: m.replyTo } : {}),
        subject: m.subject, html: m.html, text: m.text, headers: m.headers,
        ...(m.attachments.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64"), content_type: a.contentType })) } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new EmailError(`Resend couldn't be reached: ${(err as Error).message}`, true);
  }
  const body = await res.text();
  if (!res.ok) {
    let msg = body.slice(0, 300);
    try { msg = String((JSON.parse(body) as Json)["message"] ?? msg); } catch { /* keep text */ }
    throw new EmailError(`Resend refused the email (${res.status}): ${msg}`, res.status === 429 || res.status >= 500);
  }
  try { return String((JSON.parse(body) as Json)["id"] ?? ""); } catch { return ""; }
}
