import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { masterKey, open, seal, SecretBoxError } from "./secretBox";

const key = randomBytes(32);

describe("secretBox", () => {
  it("round-trips, and never stores the plain value", () => {
    const sealed = seal("re_live_secret_123", "resendApiKey", key);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("re_live_secret_123");
    expect(open(sealed, "resendApiKey", key)).toBe("re_live_secret_123");
    expect(seal("same", "f", key)).not.toBe(seal("same", "f", key)); // a fresh IV every time
  });

  it("refuses a tampered value, another field and another master key", () => {
    const sealed = seal("re_live_secret_123", "resendApiKey", key);
    const parts = sealed.split(":");
    const ct = Buffer.from(parts[3], "base64"); ct[0] ^= 1;
    expect(() => open([...parts.slice(0, 3), ct.toString("base64")].join(":"), "resendApiKey", key)).toThrow(SecretBoxError);
    expect(() => open(sealed, "hookSecret", key)).toThrow(SecretBoxError);
    expect(() => open(sealed, "resendApiKey", randomBytes(32))).toThrow(SecretBoxError);
    expect(() => open("garbage", "resendApiKey", key)).toThrow(SecretBoxError);
  });

  it("checks the master key", () => {
    expect(masterKey(undefined).key).toBeNull();
    expect(masterKey("short").problem).toMatch(/32 random bytes/);
    expect(masterKey(randomBytes(16).toString("base64")).key).toBeNull();
    expect(masterKey(key.toString("base64")).key?.equals(key)).toBe(true);
  });
});
