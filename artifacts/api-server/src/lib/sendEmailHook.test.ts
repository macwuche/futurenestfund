import { beforeAll, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";

// The hook reads its settings at import time.
process.env.SUPABASE_URL = "https://project.supabase.co";
process.env.APP_URL = "https://app.example.org";
let hook: typeof import("./sendEmailHook");
beforeAll(async () => { hook = await import("./sendEmailHook"); });

const key = randomBytes(32);
const now = () => String(Math.floor(Date.now() / 1000));
const sig = (id: string, ts: string, body: string, k = key) => `v1,${createHmac("sha256", k).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("verifyHookSignature (Standard Webhooks)", () => {
  const body = '{"x":1}';
  it("accepts a correct signature, also among several", () => {
    const ts = now();
    expect(hook.verifyHookSignature(Buffer.from(body), "msg_1", ts, sig("msg_1", ts, body), key)).toBe(true);
    expect(hook.verifyHookSignature(Buffer.from(body), "msg_1", ts, `v1,AAAA ${sig("msg_1", ts, body)}`, key)).toBe(true);
  });
  it("refuses a wrong secret, a changed body, id or timestamp, and missing parts", () => {
    const ts = now();
    const good = sig("msg_1", ts, body);
    expect(hook.verifyHookSignature(Buffer.from(body), "msg_1", ts, sig("msg_1", ts, body, randomBytes(32)), key)).toBe(false);
    expect(hook.verifyHookSignature(Buffer.from('{"x":2}'), "msg_1", ts, good, key)).toBe(false);
    expect(hook.verifyHookSignature(Buffer.from(body), "msg_2", ts, good, key)).toBe(false);
    expect(hook.verifyHookSignature(Buffer.from(body), "msg_1", String(Number(ts) + 1), good, key)).toBe(false);
    expect(hook.verifyHookSignature(Buffer.from(body), undefined, ts, good, key)).toBe(false);
    expect(hook.verifyHookSignature(Buffer.from(body), "msg_1", ts, good.replace("v1,", "v2,"), key)).toBe(false);
    expect(hook.verifyHookSignature(Buffer.from(body), "msg_1", ts, good, null)).toBe(false);
  });
  it("refuses timestamps more than five minutes off", () => {
    for (const offset of [-301, 301]) {
      const ts = String(Number(now()) + offset);
      expect(hook.verifyHookSignature(Buffer.from(body), "m", ts, sig("m", ts, body), key)).toBe(false);
    }
  });
});

describe("emailsFor", () => {
  const user = (email: string, extra = {}) => ({ email, user_metadata: { name: "Ada" }, ...extra });
  const data = (type: string, extra = {}) => ({ email_action_type: type, token: "123456", token_hash: "h_main", token_new: "", token_hash_new: "", redirect_to: "https://app.example.org/reset-password", ...extra });
  const href = (html: string) => new URL(/href="([^"]+)"/.exec(html)![1]!.replace(/&amp;/g, "&"));

  it("links to the app's /auth/confirm with the token hash, keeping next only for our own site", () => {
    const [m] = hook.emailsFor({ user: user("ada@x.org"), email_data: data("recovery") });
    const link = href(m!.html);
    expect(link.origin + link.pathname).toBe("https://app.example.org/auth/confirm");
    expect(Object.fromEntries(link.searchParams)).toEqual({ token_hash: "h_main", type: "recovery", next: "/reset-password" });
    const [other] = hook.emailsFor({ user: user("ada@x.org"), email_data: data("signup", { redirect_to: "https://evil.example/x" }) });
    expect(href(other!.html).searchParams.has("next")).toBe(false);
  });

  it("email change with Secure Email Change: current address gets token_hash_new, new address gets token_hash", () => {
    const mails = hook.emailsFor({ user: user("old@x.org", { new_email: "new@x.org" }), email_data: data("email_change", { token_hash: "for_new", token_hash_new: "for_current" }) });
    expect(mails.map((m) => [m.to, href(m.html).searchParams.get("token_hash")])).toEqual([["old@x.org", "for_current"], ["new@x.org", "for_new"]]);
  });

  it("sends an email-changed notice to the old address, and codes in the body", () => {
    const [notice] = hook.emailsFor({ user: user("new@x.org"), email_data: data("email_changed_notification", { old_email: "old@x.org" }) });
    expect(notice!.to).toBe("old@x.org");
    const [code] = hook.emailsFor({ user: user("ada@x.org"), email_data: data("reauthentication", { token: "654321" }) });
    expect(code!.text).toContain("654321");
  });

  it("refuses unknown email types instead of sending something generic", () => {
    expect(() => hook.emailsFor({ user: user("ada@x.org"), email_data: data("brand_new_type") })).toThrow(/Unsupported/);
  });
});
