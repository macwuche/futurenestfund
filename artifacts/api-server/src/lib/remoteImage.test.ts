import { describe, expect, it } from "vitest";
import { checkLogoUrl, fetchRemoteImage, isPrivateAddress } from "./remoteImage";

describe("logo links (server-side download safety)", () => {
  it("treats private, loopback, link-local and mapped addresses as private", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not-an-ip"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });
  it("accepts only plain https links", () => {
    expect(checkLogoUrl("https://example.com/logo.png").hostname).toBe("example.com");
    expect(() => checkLogoUrl("http://example.com/logo.png")).toThrow(/https/);
    expect(() => checkLogoUrl("file:///etc/passwd")).toThrow(/https/);
    expect(() => checkLogoUrl("https://user:pw@example.com/x.png")).toThrow(/user name or password/);
    expect(() => checkLogoUrl("https://example.com:8443/x.png")).toThrow(/standard https port/);
    expect(() => checkLogoUrl("not a link")).toThrow(/full image link/);
  });
  it("refuses links that point at internal addresses before connecting", async () => {
    await expect(fetchRemoteImage("https://127.0.0.1/logo.png")).rejects.toThrow(/private or internal/);
    await expect(fetchRemoteImage("https://[::1]/logo.png")).rejects.toThrow(/private or internal/);
    await expect(fetchRemoteImage("https://localhost/logo.png")).rejects.toThrow(/private or internal/);
  });
});
