import { brandPalette, normalizeHex } from "./brandColors";
import { MailInputError, escapeHtml, isEmail } from "./mailRules";

/**
 * A mailbox's signature (email.md §6, decisions Q10–Q12): logo, the sender's details in the signature's colour, and a
 * short footer (the website name for now). Built as a small email-safe table (inline styles, no web fonts) plus a
 * plain-text version, and added under emails sent from that mailbox, system emails included.
 */
export type Signature = {
  enabled: boolean;
  name: string;
  title: string;
  organisation: string;
  phone: string;
  website: string;
  email: string;
  /** Up to 3 extra links (label + https URL). */
  links: { label: string; url: string }[];
  /** #RRGGBB, or null = the app's brand colour (Settings → Branding). */
  color: string | null;
  logoFileId: string | null;
  /** Logo to the left of the details, or above them. */
  layout: "side" | "stacked";
  /** The small grey line under the divider (e.g. the website name). */
  footer: string;
};

export const emptySignature = (): Signature => ({
  enabled: true, name: "", title: "", organisation: "", phone: "", website: "", email: "", links: [], color: null, logoFileId: null, layout: "side", footer: "",
});

const LIMITS = { name: 80, title: 80, organisation: 80, phone: 40, website: 120, email: 254, footer: 200 } as const;

const text = (v: unknown, max: number, label: string) => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (s.length > max) throw new MailInputError(`${label} can be up to ${max} characters.`);
  return s;
};

const httpsUrl = (v: string, label: string) => {
  if (!v) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { throw new MailInputError(`${label} isn't a valid web address.`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new MailInputError(`${label} must be a web address (https://…).`);
  return u.toString();
};

/** Checks and tidies a signature sent by the admin's browser. */
export function parseSignature(raw: unknown): Signature {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sig = emptySignature();
  sig.enabled = o["enabled"] !== false;
  sig.name = text(o["name"], LIMITS.name, "The name");
  sig.title = text(o["title"], LIMITS.title, "The job title");
  sig.organisation = text(o["organisation"], LIMITS.organisation, "The organisation");
  sig.phone = text(o["phone"], LIMITS.phone, "The phone number");
  if (sig.phone && !/^[+\d][\d\s().-]{3,}$/.test(sig.phone)) throw new MailInputError("The phone number can only contain digits, spaces, + ( ) . and -.");
  sig.website = text(o["website"], LIMITS.website, "The website");
  if (sig.website) httpsUrl(sig.website, "The website");
  sig.email = text(o["email"], LIMITS.email, "The email address").toLowerCase();
  if (sig.email && !isEmail(sig.email)) throw new MailInputError("The signature's email address isn't valid.");
  sig.footer = text(o["footer"], LIMITS.footer, "The footer");
  const links = Array.isArray(o["links"]) ? o["links"] : [];
  if (links.length > 3) throw new MailInputError("A signature can have up to 3 links.");
  sig.links = links.map((l, i) => {
    const r = l && typeof l === "object" ? (l as Record<string, unknown>) : {};
    const label = text(r["label"], 40, `Link ${i + 1}'s label`);
    const url = httpsUrl(text(r["url"], 300, `Link ${i + 1}`), `Link ${i + 1}`);
    if (!label || !url) throw new MailInputError(`Link ${i + 1} needs a label and a web address.`);
    return { label, url };
  });
  if (o["color"] != null && o["color"] !== "") {
    const c = normalizeHex(o["color"]);
    if (!c) throw new MailInputError("Choose the signature colour as #RRGGBB.");
    sig.color = c;
  }
  sig.logoFileId = typeof o["logoFileId"] === "string" && /^[0-9a-f-]{36}$/i.test(o["logoFileId"]) ? o["logoFileId"] : null;
  sig.layout = o["layout"] === "stacked" ? "stacked" : "side";
  return sig;
}

/** A saved signature read back from the database (never throws: a broken one becomes empty). */
export function storedSignature(raw: unknown): Signature {
  try { return parseSignature(raw); } catch { return emptySignature(); }
}

export const signatureIsEmpty = (s: Signature) =>
  !s.name && !s.title && !s.organisation && !s.phone && !s.website && !s.email && !s.links.length && !s.logoFileId && !s.footer;

const displayUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * @param logoUrl public absolute URL of the logo (recipients load it), or null.
 * @param brandColor the app's brand colour, used when the signature has none of its own.
 */
export function renderSignature(s: Signature, opts: { logoUrl: string | null; brandColor: string }): { html: string; text: string } {
  if (!s.enabled || signatureIsEmpty(s)) return { html: "", text: "" };
  const p = brandPalette(s.color ?? opts.brandColor);
  // The colour as text on white must stay readable: brandPalette's `ink` is the colour nudged to 4.5:1.
  const accent = p.ink;
  const font = "font-family:Arial,Helvetica,sans-serif";
  const line2 = [s.title, s.organisation].filter(Boolean).map(escapeHtml).join(" · ");
  const contact = [
    s.phone ? `<a href="tel:${escapeHtml(s.phone.replace(/[^\d+]/g, ""))}" style="color:#5f6368;text-decoration:none">${escapeHtml(s.phone)}</a>` : "",
    s.email ? `<a href="mailto:${escapeHtml(s.email)}" style="color:#5f6368;text-decoration:none">${escapeHtml(s.email)}</a>` : "",
    s.website ? `<a href="${escapeHtml(httpsUrl(s.website, "website"))}" style="color:${accent};text-decoration:none">${escapeHtml(displayUrl(s.website))}</a>` : "",
  ].filter(Boolean).join(' <span style="color:#c4c7c5">·</span> ');
  const links = s.links.map((l) => `<a href="${escapeHtml(l.url)}" style="color:${accent};text-decoration:none;font-weight:600">${escapeHtml(l.label)}</a>`).join(' <span style="color:#c4c7c5">·</span> ');
  const details = [
    s.name ? `<div style="font-size:15px;font-weight:700;color:${accent};line-height:1.35">${escapeHtml(s.name)}</div>` : "",
    line2 ? `<div style="font-size:13px;color:#3c4043;line-height:1.5">${line2}</div>` : "",
    contact ? `<div style="font-size:13px;color:#5f6368;line-height:1.6;margin-top:2px">${contact}</div>` : "",
    links ? `<div style="font-size:13px;line-height:1.6;margin-top:2px">${links}</div>` : "",
  ].join("");
  const logo = opts.logoUrl
    ? `<img src="${escapeHtml(opts.logoUrl)}" alt="${escapeHtml(s.organisation || s.name || "Logo")}" height="48" style="display:block;height:48px;width:auto;max-width:160px;border:0">`
    : "";
  const body = logo && s.layout === "side"
    ? `<tr><td valign="top" style="padding:0 14px 0 0">${logo}</td><td valign="top" style="border-left:2px solid ${p.brand};padding:0 0 0 14px">${details}</td></tr>`
    : `${logo ? `<tr><td style="padding:0 0 10px">${logo}</td></tr>` : ""}<tr><td style="border-left:2px solid ${p.brand};padding:0 0 0 12px">${details}</td></tr>`;
  const footer = s.footer
    ? `<tr><td colspan="2" style="padding:12px 0 0"><div style="border-top:1px solid #e8eaed;padding-top:8px;font-size:11px;color:#80868b;letter-spacing:.2px">${escapeHtml(s.footer)}</div></td></tr>`
    : "";
  const html = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" data-signature style="margin:20px 0 0;${font};border-collapse:collapse">${body}${footer}</table>`;
  const text = ["--", s.name, [s.title, s.organisation].filter(Boolean).join(" · "), [s.phone, s.email, s.website && displayUrl(s.website)].filter(Boolean).join(" · "),
    ...s.links.map((l) => `${l.label}: ${l.url}`), s.footer ? `\n${s.footer}` : ""].filter(Boolean).join("\n");
  return { html, text };
}
