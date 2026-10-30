import { describe, expect, it } from "vitest";
import { authEmail, escapeHtml, moneyEmail, notificationEmail } from "./emailTemplates";

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
      expect(m.text).toContain("added to your deposit balance");
    });
  });
});
