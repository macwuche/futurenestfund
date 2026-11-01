import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { keyFilePath, keyFromFile, open, parseKey, seal, SecretBoxError } from "./secretBox";

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
    expect(parseKey(undefined).key).toBeNull();
    expect(parseKey("short").problem).toMatch(/32 random bytes/);
    expect(parseKey(randomBytes(16).toString("base64")).key).toBeNull();
    expect(parseKey(key.toString("base64")).key?.equals(key)).toBe(true);
  });

  it("creates its own key file once, private, and keeps using it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "secretbox-"));
    const file = path.join(dir, "settings.key");
    const first = keyFromFile(file);
    expect(first.key?.length).toBe(32);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = keyFromFile(file); // never replaced
    expect(again.key?.equals(first.key!)).toBe(true);
    expect(readFileSync(file, "utf8").trim()).toBe(first.key!.toString("base64"));
    const sealed = seal("re_x", "resendApiKey", first.key!);
    expect(open(sealed, "resendApiKey", keyFromFile(file).key!)).toBe("re_x");
  });

  it("reports a broken key file without overwriting it, and an unwritable folder", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "secretbox-"));
    const file = path.join(dir, "settings.key");
    writeFileSync(file, "not-a-key");
    expect(keyFromFile(file).problem).toMatch(/32 random bytes/);
    expect(readFileSync(file, "utf8")).toBe("not-a-key");
    expect(keyFromFile(path.join(dir, "missing", "settings.key")).problem).toMatch(/couldn't create/);
  });

  it("puts the key file next to the uploads folder, not inside it", () => {
    expect(keyFilePath({ UPLOAD_DIR: "/var/lib/futurenestfund/uploads" })).toBe("/var/lib/futurenestfund/settings.key");
    expect(keyFilePath({ SETTINGS_KEY_FILE: "/etc/x/k", UPLOAD_DIR: "/u" })).toBe("/etc/x/k");
  });
});
