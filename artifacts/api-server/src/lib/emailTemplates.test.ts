import { afterEach, describe, expect, it } from "vitest";
import { authEmail, escapeHtml, moneyEmail, notificationEmail, setEmailBranding, testEmail } from "./emailTemplates";
import { parseFrom } from "./email";

describe("email templates", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
  it("never puts a user's name into the HTML unescaped", () => {
    const m = authEmail("signup", "ada@x.org", { name: '<img src=x onerror="alert(1)">', link: "https://app.example.org/auth/confirm?token_hash=a&type=signup" });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(m.text).toContain("https://app.example.org/auth/confirm?token_hash=a&type=signup");
  });
  it("escapes the link inside href, and notifications too", () => {
    const m = notificationEmail("ada@x.org", "Ada", 'Approved <b>"$5"</b>', "https://app.example.org/a?b=1&c=2");
    expect(m.html).toContain('href="https://app.example.org/a?b=1&amp;c=2"');
    expect(m.html).not.toContain("<b>");
    expect(m.subject).toBe('GrantApp: Approved <b>"$5"</b>'); // subjects are plain text, not HTML
  });
  describe("money emails", () => {
    const data = { request: "Withdrawal" as const, amountCents: 123456, reference: "AB12CD34", date: "30 Oct 2026" };
    const url = "https://app.example.org/withdrawals";
    it("tells the applicant a withdrawal was received and is waiting for the finance team", () => {
      const m = moneyEmail("request_received", "ada@x.org", "Ada", data, url);
      expect(m.subject).toBe("We received your withdrawal request ($1,234.56)");
      expect(m.text).toContain("finance team will review it");
      expect(m.text).toContain("released once it's approved");
      expect(m.text).toContain("Reference: AB12CD34");
      expect(m.text).toContain("Status: Under review");
      expect(m.html).toContain('href="https://app.example.org/withdrawals"');
    });
    it("says when a withdrawal was approved", () => {
      const m = moneyEmail("request_approved", "ada@x.org", "Ada", data, url);
      expect(m.subject).toBe("Your withdrawal of $1,234.56 was approved");
      expect(m.text).toContain("Status: Approved");
    });
    it("gives the reason for a decline, escaped", () => {
      const m = moneyEmail("request_declined", "ada@x.org", "Ada", { ...data, reason: '<script>alert("x")</script> bank details' }, url);
      expect(m.subject).toBe("Your withdrawal request of $1,234.56 was declined");
      expect(m.text).toContain('Reason: <script>alert("x")</script> bank details');
      expect(m.html).not.toContain("<script>");
      expect(m.html).toContain("&lt;script&gt;");
    });
    it("words deposits as deposits", () => {
      const m = moneyEmail("request_received", "ada@x.org", "Ada", { ...data, request: "Deposit" }, "https://app.example.org/deposits");
      expect(m.subject).toBe("We received your deposit request ($1,234.56)");
      expect(m.text).toContain("added to your account balance");
    });
  });
});

describe("signature and support address (Admin Settings → Email)", () => {
  afterEach(() => setEmailBranding({ signature: null, supportEmail: null }));
  it("adds them to every kind of email, escaped, with line breaks kept", () => {
    setEmailBranding({ signature: 'Future Nest Fund\n<script>alert(1)</script>\n"Grants" team', supportEmail: "help@futurenestfund.org" });
    const emails = [
      authEmail("recovery", "ada@x.org", { link: "https://app.example.org/auth/confirm?token_hash=a&type=recovery" }),
      notificationEmail("ada@x.org", "Ada", "Hello", "https://app.example.org/"),
      moneyEmail("request_received", "ada@x.org", "Ada", { request: "Withdrawal", amountCents: 1000, reference: "ABC", date: "Oct 31, 2026" }, "https://app.example.org/withdrawals"),
      testEmail("ada@x.org", "GrantApp <no-reply@x.org>", "admin@x.org"),
    ];
    for (const m of emails) {
      expect(m.html).toContain("Future Nest Fund<br>&lt;script&gt;alert(1)&lt;/script&gt;<br>&quot;Grants&quot; team");
      expect(m.html).not.toContain("<script>");
      expect(m.html).toContain('href="mailto:help@futurenestfund.org"');
      expect(m.text).toContain("--\nFuture Nest Fund\n<script>alert(1)</script>\n\"Grants\" team");
      expect(m.text).toContain("Questions? Write to help@futurenestfund.org.");
    }
  });
  it("leaves them out when not set", () => {
    const m = notificationEmail("ada@x.org", "Ada", "Hello", "https://app.example.org/");
    expect(m.html).not.toContain("data-signature");
    expect(m.text).not.toContain("--\n");
    expect(m.text).not.toContain("Questions?");
  });
});

describe("parseFrom", () => {
  it("reads a From header or a bare address", () => {
    expect(parseFrom("GrantApp <no-reply@futurenestfund.org>")).toEqual({ name: "GrantApp", address: "no-reply@futurenestfund.org" });
    expect(parseFrom('"Future Nest, Fund" <a@b.org>')).toEqual({ name: "Future Nest, Fund", address: "a@b.org" });
    expect(parseFrom("a@b.org")).toEqual({ name: null, address: "a@b.org" });
    expect(parseFrom("")).toBeNull();
    expect(parseFrom("not an address")).toBeNull();
  });
});

describe("money emails with a payment method (Phase 10)", () => {
  const base = { request: "Withdrawal" as const, amountCents: 20000, reference: "AB12CD34", date: "4 Nov 2026" };
  it("names the method and the balance paid from, and shows an approval note escaped", () => {
    const m = moneyEmail("request_approved", "a@b.co", "Jane", { ...base, method: "Bank <transfer>", source: "deposit", reason: "Paid <today>" }, "https://x/withdrawals");
    expect(m.text).toContain("Method: Bank <transfer>");
    expect(m.text).toContain("Paid from: Your account balance");
    expect(m.text).toContain("released from your account balance");
    expect(m.text).toContain("Note: Paid <today>");
    expect(m.html).not.toContain("<transfer>");
    expect(m.html).not.toContain("<today>");
  });
  it("leaves the rows out when there's no method or note", () => {
    const m = moneyEmail("request_approved", "a@b.co", "Jane", base, "https://x/withdrawals");
    expect(m.text).not.toContain("Method:");
    expect(m.text).not.toContain("Note:");
  });
});

describe("money emails with a fee (9.3)", () => {
  it("withdrawal: fee from the account balance and the total", () => {
    const m = moneyEmail("request_received", "a@b.co", "Jane", { request: "Withdrawal", amountCents: 20000, reference: "R1", date: "4 Nov 2026", source: "grant", feeCents: 200 }, "https://x/withdrawals");
    expect(m.text).toContain("Fee: $2.00, from your account balance");
    expect(m.text).toContain("Total: $202.00");
  });
  it("deposit: what the user receives after the fee", () => {
    const m = moneyEmail("request_approved", "a@b.co", "Jane", { request: "Deposit", amountCents: 10000, reference: "R2", date: "4 Nov 2026", feeCents: 300 }, "https://x/deposits");
    expect(m.text).toContain("Fee: $3.00");
    expect(m.text).toContain("You receive: $97.00");
  });
  it("no fee rows without a fee", () => {
    const m = moneyEmail("request_approved", "a@b.co", "Jane", { request: "Deposit", amountCents: 10000, reference: "R3", date: "4 Nov 2026" }, "https://x/deposits");
    expect(m.text).not.toContain("Fee:");
  });
});
