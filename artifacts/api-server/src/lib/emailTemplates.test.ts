import { describe, expect, it } from "vitest";
import { authEmail, escapeHtml, notificationEmail } from "./emailTemplates";

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
});
