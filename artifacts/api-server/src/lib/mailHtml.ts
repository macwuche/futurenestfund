import sanitizeHtml from "sanitize-html";

/**
 * Received email HTML is untrusted (email.md §7). It's cleaned here once, when the email arrives, and the web app shows
 * it inside a shadow root under the site's strict Content-Security-Policy (no inline scripts), so it gets two layers.
 *
 * - Only an allow-list of formatting tags and attributes survives: no scripts, styles blocks, forms, frames, objects,
 *   event handlers, `javascript:` / `data:` links, or CSS that loads anything (`url(`, `@import`, `expression(`).
 * - Images on the internet are not loaded: their address moves to `data-remote-src` and `src` is emptied. The reader
 *   offers "Show images", which loads them through our image proxy, so the sender never sees the admin's address and
 *   tracking pixels don't fire on opening.
 * - `cid:` images (inline attachments) point at our stored copy; small `data:` images (PNG, JPEG, GIF, WebP) are kept.
 * - Links open in a new tab without a referrer.
 */

const TAGS = [
  "a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "del",
  "div", "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p",
  "pre", "q", "s", "small", "span", "strike", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt",
  "u", "ul", "wbr",
];
const COMMON = ["style", "align", "valign", "dir", "lang", "title", "width", "height", "bgcolor", "color", "border", "class"];

const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const BAD_CSS = /url\s*\(|@import|expression\s*\(|behavior\s*:|-moz-binding|javascript:/i;

/** Drops CSS declarations that could load something or run script; keeps the rest (colours, fonts, spacing, layout). */
export function cleanStyle(style: string): string {
  return style.split(";").map((d) => d.trim()).filter((d) => d && d.includes(":") && !BAD_CSS.test(d) && !/position\s*:\s*(fixed|absolute|sticky)/i.test(d)).join("; ");
}

export type CleanResult = { html: string; remoteImages: boolean };

/**
 * @param cidUrl maps an inline image's Content-ID (without `<>`) to our URL for it, or null when we don't have it.
 */
export function cleanEmailHtml(raw: string, cidUrl: (cid: string) => string | null = () => null): CleanResult {
  let remoteImages = false;
  // Only the body matters; anything in <head> (and <style>) goes with it.
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(raw)?.[1] ?? raw;
  const html = sanitizeHtml(body, {
    allowedTags: TAGS,
    allowedAttributes: {
      "*": COMMON,
      a: [...COMMON, "href", "name", "target", "rel"],
      img: [...COMMON, "src", "alt", "data-remote-src"],
      td: [...COMMON, "colspan", "rowspan", "nowrap"],
      th: [...COMMON, "colspan", "rowspan", "nowrap", "scope"],
      table: [...COMMON, "cellpadding", "cellspacing", "summary"],
      col: [...COMMON, "span"],
      colgroup: [...COMMON, "span"],
      font: [...COMMON, "face", "size"],
      ol: [...COMMON, "start", "type"],
      li: [...COMMON, "value"],
      blockquote: [...COMMON, "cite"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "head", "template", "svg", "math", "iframe", "object"],
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs["href"] ?? "";
        const out: Record<string, string> = { ...attribs, rel: "noopener noreferrer nofollow" };
        if (/^https?:/i.test(href)) out["target"] = "_blank"; else delete out["target"];
        return { tagName, attribs: out };
      },
      img: (tagName, attribs) => {
        const src = (attribs["src"] ?? "").trim();
        const out: Record<string, string> = { ...attribs };
        delete out["data-remote-src"];
        if (/^cid:/i.test(src)) {
          const url = cidUrl(src.slice(4).replace(/^<|>$/g, ""));
          if (url) out["src"] = url; else { delete out["src"]; out["alt"] = attribs["alt"] || "[image]"; }
        } else if (/^data:/i.test(src)) {
          if (!SAFE_DATA_IMAGE.test(src) || src.length > 2_000_000) delete out["src"];
        } else if (/^https?:\/\//i.test(src)) {
          remoteImages = true;
          out["data-remote-src"] = src;
          delete out["src"];
        } else delete out["src"];
        return { tagName, attribs: out };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs["src"] && !frame.attribs["data-remote-src"] && !frame.attribs["alt"],
    // Styles are checked by hand (sanitize-html's allowedStyles is an allow-list per property; this keeps email layouts).
    allowedStyles: undefined,
  });
  // sanitize-html keeps style attributes as-is when allowedStyles is unset: filter them here.
  const styled = html.replace(/\sstyle="([^"]*)"/gi, (_m, s: string) => {
    const clean = cleanStyle(s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
    return clean ? ` style="${clean.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"` : "";
  });
  return { html: styled.trim(), remoteImages };
}

/**
 * HTML the administrator wrote in Compose (TipTap): our own editor, but it's still checked, since the API can be called
 * directly. Only the editor's formatting survives; no images from the internet.
 */
export function cleanComposedHtml(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "code", "pre", "hr", "span", "div"],
    allowedAttributes: { a: ["href", "target", "rel"], span: ["style"], p: ["style"], div: ["class", "style"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    allowedStyles: { "*": { color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i], "text-align": [/^(left|right|center|justify)$/] } },
    transformTags: { a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }) },
  });
}
