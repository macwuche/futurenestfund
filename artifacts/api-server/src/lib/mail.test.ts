import { describe, expect, it } from "vitest";
import {
  MailInputError, authFailed, baseSubject, checkAttachment, cleanFileName, forwardBlock, htmlToText, parseAddress, parseAddressList, replyQuote,
  replyRecipients, replyReferences, replySubject, snippetOf,
} from "./mailRules";
import { cleanComposedHtml, cleanEmailHtml, cleanStyle } from "./mailHtml";
import { emptySignature, parseSignature, renderSignature } from "./mailSignature";

describe("mail addresses and subjects", () => {
  it("parses addresses with and without names", () => {
    expect(parseAddress("Jane Cooper <Jane@Example.org>")).toEqual({ address: "jane@example.org", name: "Jane Cooper" });
    expect(parseAddress('"Doe, John" <john@x.io>')).toEqual({ address: "john@x.io", name: "Doe, John" });
    expect(parseAddress("plain@x.io")).toEqual({ address: "plain@x.io", name: null });
    expect(parseAddress("not an address")).toBeNull();
    expect(parseAddress("a@b")).toBeNull();
  });
  it("splits lists on commas and semicolons outside quotes, removes duplicates, refuses bad ones", () => {
    expect(parseAddressList('a@x.io; "Doe, J" <j@x.io>, A@x.io').map((a) => a.address)).toEqual(["a@x.io", "j@x.io"]);
    expect(parseAddressList(["a@x.io", "b@x.io"])).toHaveLength(2);
    expect(() => parseAddressList("a@x.io, nope")).toThrow(MailInputError);
  });
  it("normalises subjects and builds reply / forward subjects", () => {
    expect(baseSubject("Re: RE: Fwd: Hello  there")).toBe("Hello there");
    expect(baseSubject("AW: Re[2]: Antrag")).toBe("Antrag");
    expect(replySubject("Re: Grant question")).toBe("Re: Grant question");
    expect(replySubject("")).toBe("Re: (no subject)");
  });
  it("threads replies with References and In-Reply-To", () => {
    expect(replyReferences({ messageId: "<c@x>", references: "<a@x> <b@x>", inReplyTo: "<b@x>" })).toBe("<a@x> <b@x> <c@x>");
    expect(replyReferences({ messageId: "<c@x>", references: null, inReplyTo: "<b@x>" })).toBe("<b@x> <c@x>");
    expect(replyReferences({ messageId: null, references: null, inReplyTo: null })).toBeNull();
  });
  it("works out who a reply goes to", () => {
    const m = { direction: "in", fromAddress: "jane@x.io", fromName: "Jane", to: [{ address: "support@fnf.org", name: null }, { address: "bob@x.io", name: null }], cc: [{ address: "cc@x.io", name: null }], replyTo: [] };
    expect(replyRecipients(m, "support@fnf.org", false)).toEqual({ to: [{ address: "jane@x.io", name: "Jane" }], cc: [] });
    expect(replyRecipients(m, "support@fnf.org", true).cc.map((a) => a.address)).toEqual(["bob@x.io", "cc@x.io"]);
    expect(replyRecipients({ ...m, replyTo: [{ address: "other@x.io", name: null }] }, "support@fnf.org", false).to[0]!.address).toBe("other@x.io");
  });
  it("makes snippets without quoted history, and readable text from HTML", () => {
    expect(snippetOf("Thanks!\n\nOn Mon, 1 Jan, Jane wrote:\n> old")).toBe("Thanks!");
    expect(htmlToText('<p>Hi <b>there</b></p><p><a href="https://x.io">site</a></p><script>x()</script>')).toBe("Hi there\nsite (https://x.io)");
  });
  it("quotes and forwards with escaped headers", () => {
    const q = replyQuote({ fromAddress: "j@x.io", fromName: "J <script>", date: new Date("2026-01-01T10:00:00Z"), html: "<p>old</p>", text: "old" });
    expect(q.html).toContain("J &lt;script&gt;");
    expect(q.text).toContain("> old");
    const f = forwardBlock({ fromAddress: "j@x.io", fromName: null, date: new Date(), subject: "S", to: [{ address: "a@x.io", name: null }], cc: [], html: "", text: "body" });
    expect(f.text).toContain("---------- Forwarded message ---------");
    expect(f.html).toContain("<p>body</p>");
  });
  it("reads authentication failures", () => {
    expect(authFailed({ spf: "pass", dkim: "pass", dmarc: "pass" })).toBe(false);
    expect(authFailed({ spf: "fail", dkim: "pass" })).toBe(true);
    expect(authFailed({ dmarc: { result: "fail" } })).toBe(true);
    expect(authFailed(null)).toBe(false);
  });
});

describe("mail attachments", () => {
  const zip = (part: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from(part)]);
  it("accepts documents, images and text by their bytes, fixing the extension", () => {
    expect(checkAttachment(Buffer.from("%PDF-1.7\n...%%EOF"), "letter.pdf")).toMatchObject({ ok: true, type: "application/pdf", name: "letter.pdf" });
    expect(checkAttachment(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), "photo.png")).toMatchObject({ ok: true, ext: "jpg", name: "photo.png.jpg".replace(".png.jpg", ".jpg") });
    expect(checkAttachment(zip("word/document.xml"), "plan.docx")).toMatchObject({ ok: true, ext: "docx" });
    expect(checkAttachment(zip("xl/workbook.xml"), "budget.xlsx")).toMatchObject({ ok: true, ext: "xlsx" });
    expect(checkAttachment(zip("ppt/presentation.xml"), "deck.pptx")).toMatchObject({ ok: true, ext: "pptx" });
    expect(checkAttachment(Buffer.from("name,amount\nJane,10\n"), "list.csv")).toMatchObject({ ok: true, type: "text/csv" });
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("WordDocument", "utf16le")]);
    expect(checkAttachment(ole, "old.doc")).toMatchObject({ ok: true, ext: "doc" });
  });
  it("refuses programs, archives, web pages, macros and active PDFs", () => {
    expect(checkAttachment(Buffer.from("MZ\x90\x00 program bytes here"), "invoice.pdf").ok).toBe(false);
    expect(checkAttachment(zip("some/other.txt"), "files.zip").ok).toBe(false);
    expect(checkAttachment(Buffer.from("<html><script>alert(1)</script></html>"), "page.txt").ok).toBe(false);
    expect(checkAttachment(zip("word/document.xml vbaProject.bin"), "plan.docm")).toMatchObject({ ok: false });
    const oleMacro = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("Macros", "utf16le")]);
    expect(checkAttachment(oleMacro, "old.doc").ok).toBe(false);
    expect(checkAttachment(Buffer.from("%PDF-1.4 /JavaScript (x) %%EOF"), "x.pdf").ok).toBe(false);
    expect(checkAttachment(Buffer.alloc(0), "empty.txt").ok).toBe(false);
    expect(checkAttachment(Buffer.from("%PDF-1.4"), "big.pdf", 4).ok).toBe(false);
  });
  it("cleans file names", () => {
    expect(cleanFileName("../../etc/pass:wd")).toBe("password".replace("word", "wd"));
    expect(cleanFileName("")).toBe("attachment");
  });
});

describe("received HTML", () => {
  it("removes scripts, handlers, forms and frames", () => {
    const { html } = cleanEmailHtml('<p onclick="x()">Hi<script>alert(1)</script></p><form><input></form><iframe src="https://x"></iframe><a href="javascript:alert(1)">x</a>');
    expect(html).not.toMatch(/script|onclick|<form|<input|<iframe|javascript:/i);
    expect(html).toContain("<p>Hi</p>");
  });
  it("holds back remote images and keeps cid: and safe data: images", () => {
    const r = cleanEmailHtml('<img src="https://tracker.example/p.gif"><img src="cid:logo1"><img src="data:image/png;base64,iVBORw0KGgo="><img src="data:text/html;base64,PHNjcmlwdD4=">',
      (cid) => (cid === "logo1" ? "/api/admin/mail/files/abc" : null));
    expect(r.remoteImages).toBe(true);
    expect(r.html).toContain('data-remote-src="https://tracker.example/p.gif"');
    expect(r.html).not.toMatch(/ src="https:\/\/tracker/);
    expect(r.html).toContain('src="/api/admin/mail/files/abc"');
    expect(r.html).toContain("data:image/png;base64");
    expect(r.html).not.toContain("data:text/html");
  });
  it("drops CSS that loads things or escapes the reader, and keeps formatting", () => {
    expect(cleanStyle("color:red; background:url(https://t.io/x.gif); position:fixed; font-size:14px")).toBe("color:red; font-size:14px");
    const { html } = cleanEmailHtml('<div style="color:#333;background-image:url(http://x)">x</div><style>body{background:url(http://x)}</style>');
    expect(html).toBe('<div style="color:#333">x</div>');
  });
  it("opens links in a new tab without a referrer", () => {
    expect(cleanEmailHtml('<a href="https://x.io">x</a>').html).toContain('target="_blank"');
    expect(cleanEmailHtml('<a href="https://x.io">x</a>').html).toContain("noreferrer");
  });
  it("keeps only editor formatting in composed HTML", () => {
    const html = cleanComposedHtml('<p style="text-align:center;position:fixed">Hi <img src="https://x/y.png"><strong>there</strong></p><script>x</script>');
    expect(html).toBe('<p style="text-align:center">Hi <strong>there</strong></p>');
  });
});

describe("signatures", () => {
  it("checks the fields", () => {
    expect(() => parseSignature({ ...emptySignature(), color: "red" })).toThrow(MailInputError);
    expect(() => parseSignature({ ...emptySignature(), links: [1, 2, 3, 4] })).toThrow(MailInputError);
    expect(() => parseSignature({ ...emptySignature(), email: "nope" })).toThrow(MailInputError);
    expect(parseSignature({ ...emptySignature(), website: "futurenestfund.org", color: "#16a34a" })).toMatchObject({ website: "futurenestfund.org", color: "#16A34A" });
  });
  it("renders escaped, email-safe HTML with the colour, logo and footer, plus text", () => {
    const sig = parseSignature({ ...emptySignature(), name: "Ada <Lovelace>", title: "Grants Manager", organisation: "Future Nest Fund", website: "https://futurenestfund.org", footer: "futurenestfund.org", color: "#16A34A" });
    const r = renderSignature(sig, { logoUrl: "https://access.futurenestfund.org/api/mail/signature-logo/1", brandColor: "#1E3A8A" });
    expect(r.html).toContain("Ada &lt;Lovelace&gt;");
    expect(r.html).toContain("signature-logo/1");
    expect(r.html).toContain("border-left:2px solid #16A34A");
    expect(r.html).toContain("futurenestfund.org</div>");
    expect(r.text).toMatch(/^--\nAda <Lovelace>\nGrants Manager · Future Nest Fund/);
  });
  it("renders nothing when switched off or empty", () => {
    expect(renderSignature({ ...emptySignature(), name: "x", enabled: false }, { logoUrl: null, brandColor: "#000000" }).html).toBe("");
    expect(renderSignature(emptySignature(), { logoUrl: null, brandColor: "#000000" }).html).toBe("");
  });
});
