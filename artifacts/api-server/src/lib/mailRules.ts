/**
 * Pure rules for the admin Mail box (Phase 14, email.md): addresses, subjects, threading headers, quoting, snippets and
 * which attachment types are accepted. No database or network here, so it's unit-tested (mailRules.test.ts).
 */

export type Address = { address: string; name: string | null };

export class MailInputError extends Error {}

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isEmail = (s: string) => s.length <= 254 && EMAIL.test(s);

const cleanName = (s: string | null | undefined) => {
  const v = (s ?? "").replace(/^["'\s]+|["'\s]+$/g, "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 120);
  return v || null;
};

/** One address: `a@b.c`, `<a@b.c>` or `Name <a@b.c>`. Null when it isn't a valid address. */
export function parseAddress(raw: string | null | undefined): Address | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const m = /^(.*?)<\s*([^<>\s]+)\s*>\s*$/.exec(s);
  const address = (m ? m[2]! : s).trim().toLowerCase();
  if (!isEmail(address)) return null;
  return { address, name: m ? cleanName(m[1]) : null };
}

/** Splits a list on commas / semicolons that aren't inside quotes; refuses the whole list if one address is wrong. */
export function parseAddressList(raw: string | string[] | null | undefined, max = 50): Address[] {
  const parts: string[] = [];
  for (const chunk of Array.isArray(raw) ? raw : [raw ?? ""]) {
    let cur = "", quoted = false;
    for (const ch of chunk) {
      if (ch === '"') quoted = !quoted;
      if ((ch === "," || ch === ";") && !quoted) { parts.push(cur); cur = ""; } else cur += ch;
    }
    parts.push(cur);
  }
  const out: Address[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    const a = parseAddress(p);
    if (!a) throw new MailInputError(`"${p.slice(0, 80)}" isn't a valid email address.`);
    if (!out.some((o) => o.address === a.address)) out.push(a);
  }
  if (out.length > max) throw new MailInputError(`An email can go to at most ${max} addresses in one field.`);
  return out;
}

export const formatAddress = (a: Address) => (a.name ? `"${a.name.replace(/["\\]/g, "")}" <${a.address}>` : a.address);

/** "Re: Fwd: RE: Hello" → "Hello" (for grouping and for building reply subjects). */
export function baseSubject(subject: string | null | undefined): string {
  let s = (subject ?? "").replace(/\s+/g, " ").trim();
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|wg|tr)(\[\d+\])?\s*:\s*/i, "");
    if (next === s) return s;
    s = next;
  }
}
export const replySubject = (s: string) => `Re: ${baseSubject(s) || "(no subject)"}`;
export const forwardSubject = (s: string) => `Fwd: ${baseSubject(s) || "(no subject)"}`;

/** Message-ID values in a References / In-Reply-To header, in order, each with its angle brackets. */
export function messageIds(header: string | null | undefined): string[] {
  return [...(header ?? "").matchAll(/<[^<>\s]+>/g)].map((m) => m[0]);
}

/** References for a reply: the original's references plus its own id (kept to the last 20). */
export function replyReferences(original: { messageId: string | null; references: string | null; inReplyTo: string | null }): string | null {
  const ids = messageIds(original.references);
  if (!ids.length) ids.push(...messageIds(original.inReplyTo));
  if (original.messageId && !ids.includes(original.messageId)) ids.push(original.messageId);
  return ids.length ? ids.slice(-20).join(" ") : null;
}

export const newMessageId = (uuid: string, domain: string) => `<${uuid}@${domain}>`;

/** Who a reply goes to: Reply-To if the sender set one, else the sender. Reply all adds To and Cc, minus our mailbox. */
export function replyRecipients(m: { direction: string; fromAddress: string; fromName: string | null; to: Address[]; cc: Address[]; replyTo: Address[] }, mailbox: string, all: boolean) {
  const self = mailbox.toLowerCase();
  const sender = m.replyTo.length ? m.replyTo : [{ address: m.fromAddress, name: m.fromName }];
  // Replying to our own sent message continues to the same people.
  const to = m.direction === "out" ? m.to : sender;
  const cc = all ? [...(m.direction === "out" ? [] : m.to), ...m.cc] : [];
  const seen = new Set<string>([self]);
  const keep = (list: Address[]) => list.filter((a) => (seen.has(a.address) ? false : (seen.add(a.address), true)));
  return { to: keep(to), cc: keep(cc) };
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Plain text → simple HTML (paragraphs, line breaks, links). */
export function textToHtml(text: string): string {
  return text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</p>`).join("");
}

/** HTML → readable text (for the plain-text part, snippets and search). Not a sanitiser. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|blockquote|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => (label.replace(/<[^>]+>/g, "").trim() === href ? href : `${label} (${href})`))
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** First ~140 characters of the text, without quoted history. */
export function snippetOf(text: string, max = 140): string {
  const body = text.split(/\n(?:On .{5,200}wrote:|-{2,} ?Forwarded message ?-{2,}|>)/)[0] ?? text;
  const one = body.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

const fmtDate = (d: Date) => d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/** The quoted original under a reply ("On …, Jane <jane@…> wrote:"). */
export function replyQuote(m: { fromAddress: string; fromName: string | null; date: Date; html: string; text: string }) {
  const who = m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress;
  const head = `On ${fmtDate(m.date)}, ${who} wrote:`;
  return {
    html: `<div class="gp-quote"><p style="margin:16px 0 8px;color:#5f6368">${escapeHtml(head)}</p><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${m.html || textToHtml(m.text)}</blockquote></div>`,
    text: `\n\n${head}\n${m.text.split("\n").map((l) => `> ${l}`).join("\n")}`,
  };
}

/** The header block of a forwarded message. */
export function forwardBlock(m: { fromAddress: string; fromName: string | null; date: Date; subject: string; to: Address[]; cc: Address[]; html: string; text: string }) {
  const rows: [string, string][] = [
    ["From", m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress],
    ["Date", fmtDate(m.date)],
    ["Subject", m.subject || "(no subject)"],
    ["To", m.to.map(formatAddress).join(", ")],
    ...(m.cc.length ? [["Cc", m.cc.map(formatAddress).join(", ")] as [string, string]] : []),
  ];
  return {
    html: `<div class="gp-forward"><p style="margin:16px 0 8px;color:#5f6368">---------- Forwarded message ---------<br>${rows.map(([k, v]) => `${k}: ${escapeHtml(v)}`).join("<br>")}</p>${m.html || textToHtml(m.text)}</div>`,
    text: `\n\n---------- Forwarded message ---------\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${m.text}`,
  };
}

/** SPF / DKIM / DMARC from Resend: failed when any of them says "fail". */
export function authFailed(auth: unknown): boolean {
  if (!auth || typeof auth !== "object") return false;
  return Object.values(auth as Record<string, unknown>).some((v) => {
    const s = typeof v === "string" ? v : v && typeof v === "object" ? String((v as Record<string, unknown>)["result"] ?? (v as Record<string, unknown>)["status"] ?? "") : "";
    return /^(fail|softfail|permerror)$/i.test(s);
  });
}

/* ---------------------------------------------------------------- attachments */

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_RECEIVED_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Resend allows 40 MB per email after base64; 25 MB of files stays under it. */
export const MAX_ATTACHMENTS_TOTAL = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

type Kind = { type: string; ext: string; label: string; exts: string[] };
const K = (type: string, ext: string, label: string, exts: string[] = [ext]): Kind => ({ type, ext, label, exts });
const PDF = K("application/pdf", "pdf", "PDF");
const JPG = K("image/jpeg", "jpg", "JPG image", ["jpg", "jpeg", "jfif"]);
const PNG = K("image/png", "png", "PNG image");
const GIF = K("image/gif", "gif", "GIF image");
const WEBP = K("image/webp", "webp", "WebP image");
const HEIC = K("image/heic", "heic", "HEIC photo", ["heic", "heif"]);
const DOCX = K("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", "Word document");
const XLSX = K("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", "Excel workbook");
const PPTX = K("application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", "PowerPoint presentation", ["pptx", "ppsx"]);
const ODT = K("application/vnd.oasis.opendocument.text", "odt", "OpenDocument text");
const ODS = K("application/vnd.oasis.opendocument.spreadsheet", "ods", "OpenDocument spreadsheet");
const ODP = K("application/vnd.oasis.opendocument.presentation", "odp", "OpenDocument presentation");
const DOC = K("application/msword", "doc", "Word 97–2003 document");
const XLS = K("application/vnd.ms-excel", "xls", "Excel 97–2003 workbook");
const PPT = K("application/vnd.ms-powerpoint", "ppt", "PowerPoint 97–2003 presentation", ["ppt", "pps"]);
const TXT = K("text/plain", "txt", "text file");
const CSV = K("text/csv", "csv", "CSV file");
const RTF = K("application/rtf", "rtf", "RTF document");

export const ACCEPTED_ATTACHMENTS = "PDF, images (JPG, PNG, GIF, WebP, HEIC), Word, Excel, PowerPoint, OpenDocument, text, CSV and RTF files";
/** For the file picker. */
export const ATTACHMENT_EXTENSIONS = [PDF, JPG, PNG, GIF, WEBP, HEIC, DOCX, XLSX, PPTX, ODT, ODS, ODP, DOC, XLS, PPT, TXT, CSV, RTF].flatMap((k) => k.exts);

const extOf = (name: string) => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? "";
const has = (buf: Buffer, s: string) => buf.includes(Buffer.from(s, "latin1"));
const hasUtf16 = (buf: Buffer, s: string) => buf.includes(Buffer.from(s, "utf16le"));

/** Zip containers: Office Open XML and OpenDocument, told apart by their parts. */
function zipKind(buf: Buffer): Kind | "macro" | null {
  if (has(buf, "vbaProject.bin") || has(buf, "vbaData.xml")) return "macro";
  if (has(buf, "word/document.xml") || has(buf, "word/_rels")) return DOCX;
  if (has(buf, "xl/workbook.xml") || has(buf, "xl/_rels")) return XLSX;
  if (has(buf, "ppt/presentation.xml") || has(buf, "ppt/_rels")) return PPTX;
  const mime = /^PK\x03\x04[\s\S]{26}mimetype(application\/vnd\.oasis\.opendocument\.(text|spreadsheet|presentation))/.exec(buf.subarray(0, 200).toString("latin1"));
  if (mime) return mime[2] === "text" ? ODT : mime[2] === "spreadsheet" ? ODS : ODP;
  return null;
}

/** Old binary Office files (OLE compound files): the name decides which, the contents must not carry macros. */
function oleKind(buf: Buffer, ext: string): Kind | "macro" | null {
  if (hasUtf16(buf, "_VBA_PROJECT") || hasUtf16(buf, "Macros")) return "macro";
  if (hasUtf16(buf, "WordDocument")) return DOC;
  if (hasUtf16(buf, "Workbook")) return XLS;
  if (hasUtf16(buf, "PowerPoint Document")) return PPT;
  return ext === "doc" ? DOC : ext === "xls" ? XLS : ext === "ppt" || ext === "pps" ? PPT : null;
}

function looksLikeText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, 64 * 1024)); return true; } catch { return false; }
}

export type FileVerdict = { ok: true; type: string; ext: string; name: string } | { ok: false; reason: string };

/**
 * What a file really is, from its bytes (the name and the sender's stated type are ignored), and whether it may be kept.
 * Accepted (email.md Q15): PDF, images, Word / Excel / PowerPoint (new and 97–2003), OpenDocument, text, CSV, RTF.
 * Refused: anything else (programs, scripts, archives, disk images, HTML, SVG…), Office files with macros, PDFs with
 * scripts or launch actions, and files over the size limit. The stored name always ends in the real type's extension.
 */
export function checkAttachment(buf: Buffer, rawName: string, maxBytes = MAX_ATTACHMENT_BYTES): FileVerdict {
  const name = cleanFileName(rawName);
  if (buf.length === 0) return { ok: false, reason: "The file is empty." };
  if (buf.length > maxBytes) return { ok: false, reason: `Files can be up to ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  const ext = extOf(name);
  let kind: Kind | "macro" | null = null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) kind = JPG;
  else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) kind = PNG;
  else if (/^GIF8[79]a/.test(buf.toString("latin1", 0, 6))) kind = GIF;
  else if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") kind = WEBP;
  else if (buf.toString("latin1", 4, 8) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(buf.toString("latin1", 8, 12))) kind = HEIC;
  else if (buf.toString("latin1", 0, 5) === "%PDF-") kind = PDF;
  else if (buf.readUInt32LE(0) === 0x04034b50) kind = zipKind(buf);
  else if (buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) kind = oleKind(buf, ext);
  else if (buf.toString("latin1", 0, 5) === "{\\rtf") kind = /\\object/.test(buf.toString("latin1")) ? "macro" : RTF;
  else if (looksLikeText(buf) && (ext === "txt" || ext === "csv" || ext === "")) {
    const head = buf.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
    if (head.startsWith("<") || head.startsWith("#!")) return { ok: false, reason: "Web pages and scripts can't be attached." };
    kind = ext === "csv" ? CSV : TXT;
  }
  if (kind === "macro") return { ok: false, reason: "Files with macros or embedded objects aren't accepted. Save a copy without macros (e.g. .docx instead of .docm)." };
  if (!kind) return { ok: false, reason: `This type of file isn't accepted. Allowed: ${ACCEPTED_ATTACHMENTS}.` };
  if (kind === PDF) {
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(buf.toString("latin1"))) return { ok: false, reason: "PDFs with scripts or embedded files aren't accepted. Export a plain PDF." };
  }
  const base = name.replace(/\.[^.]*$/, "") || "attachment";
  return { ok: true, type: kind.type, ext: kind.ext, name: kind.exts.includes(ext) ? name : `${base}.${kind.ext}` };
}

/** Display-only file name: no path parts or control characters, sensible length. */
export function cleanFileName(raw: string): string {
  const base = (raw.replace(/\\/g, "/").split("/").pop() ?? "").replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").trim();
  if (!base) return "attachment";
  if (base.length <= 120) return base;
  const ext = extOf(base);
  return `${base.slice(0, 110)}${ext ? `.${ext}` : ""}`;
}
