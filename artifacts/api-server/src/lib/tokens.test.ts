import { describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, errors, type JWTVerifyGetKey } from "jose";
import { createHmac } from "node:crypto";
import { AuthError, AuthUnavailable, verifySupabaseToken } from "./tokens";

const ISS = "https://project.supabase.co/auth/v1";
const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: "key-1", alg: "ES256", use: "sig" };
const keys = createLocalJWKSet({ keys: [jwk] });
const now = () => Math.floor(Date.now() / 1000);
const claims = { sub: "11111111-1111-4111-8111-111111111111", email: "ada@example.org", role: "authenticated", app_metadata: { role: "admin" } };
const sign = (payload: Record<string, unknown> = {}, opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: number } = {}) =>
  new SignJWT({ ...claims, ...payload }).setProtectedHeader({ alg: "ES256", kid: "key-1" }).setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? "authenticated").setIssuedAt().setExpirationTime(opts.exp ?? now() + 3600).sign(opts.key ?? privateKey);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("verifySupabaseToken", () => {
  it("accepts a valid token and returns its claims", async () => {
    const c = await verifySupabaseToken(await sign(), keys, ISS);
    expect(c.sub).toBe(claims.sub);
    expect(c.email).toBe("ada@example.org");
    expect(c.app_metadata).toEqual({ role: "admin" });
  });

  it.each([
    ["expired", () => sign({}, { exp: now() - 10 })],
    ["another project's issuer", () => sign({}, { iss: "https://other.supabase.co/auth/v1" })],
    ["wrong audience", () => sign({}, { aud: "service_role" })],
    ["anonymous (anon role)", () => sign({ role: "anon" })],
    ["no email", () => sign({ email: undefined })],
  ])("refuses a token that is %s", async (_label, make) => {
    await expect(verifySupabaseToken(await make(), keys, ISS)).rejects.toBeInstanceOf(AuthError);
  });

  it("refuses a token signed by another key that claims the same key id", async () => {
    const other = await generateKeyPair("ES256");
    await expect(verifySupabaseToken(await sign({}, { key: other.privateKey }), keys, ISS)).rejects.toBeInstanceOf(AuthError);
  });

  it("refuses a tampered payload (e.g. self-promotion to admin)", async () => {
    const [h, , s] = (await sign({ app_metadata: {} })).split(".");
    const forged = `${h}.${b64({ ...claims, iss: ISS, aud: "authenticated", exp: now() + 3600, app_metadata: { role: "root" } })}.${s}`;
    await expect(verifySupabaseToken(forged, keys, ISS)).rejects.toBeInstanceOf(AuthError);
  });

  it('refuses alg "none"', async () => {
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ ...claims, iss: ISS, aud: "authenticated", exp: now() + 3600 })}.`;
    await expect(verifySupabaseToken(none, keys, ISS)).rejects.toBeInstanceOf(AuthError);
  });

  it("refuses HS256 signed with the public key (algorithm confusion)", async () => {
    const header = b64({ alg: "HS256", typ: "JWT", kid: "key-1" });
    const body = b64({ ...claims, iss: ISS, aud: "authenticated", exp: now() + 3600 });
    const sig = createHmac("sha256", JSON.stringify(jwk)).update(`${header}.${body}`).digest("base64url");
    await expect(verifySupabaseToken(`${header}.${body}.${sig}`, keys, ISS)).rejects.toBeInstanceOf(AuthError);
  });

  it("refuses garbage", async () => {
    await expect(verifySupabaseToken("not.a.jwt", keys, ISS)).rejects.toBeInstanceOf(AuthError);
  });

  it("reports an unreachable key server as unavailable (503), not as a bad token", async () => {
    const down: JWTVerifyGetKey = async () => { throw new TypeError("fetch failed"); };
    const slow: JWTVerifyGetKey = async () => { throw new errors.JWKSTimeout(); };
    await expect(verifySupabaseToken(await sign(), down, ISS)).rejects.toBeInstanceOf(AuthUnavailable);
    await expect(verifySupabaseToken(await sign(), slow, ISS)).rejects.toBeInstanceOf(AuthUnavailable);
  });
});
