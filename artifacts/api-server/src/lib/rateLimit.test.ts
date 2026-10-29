import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { rateLimit } from "./rateLimit";

const req = (ip: string, authUserId?: string) => ({ ip, identity: authUserId ? { authUserId } : undefined }) as unknown as Request;
const res = () => {
  const r = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown,
    setHeader(k: string, v: string) { r.headers[k] = v; }, status(c: number) { r.statusCode = c; return r; }, json(b: unknown) { r.body = b; return r; } };
  return r;
};
const call = (mw: ReturnType<typeof rateLimit>, rq: Request) => { const r = res(); let passed = false; mw(rq, r as unknown as Response, () => { passed = true; }); return { passed, r }; };

afterEach(() => { vi.useRealTimers(); });

describe("rateLimit", () => {
  it("allows up to the limit, then answers 429 with Retry-After", () => {
    const mw = rateLimit({ name: "t", limit: 2, windowMs: 60_000 });
    expect(call(mw, req("1.1.1.1")).passed).toBe(true);
    expect(call(mw, req("1.1.1.1")).passed).toBe(true);
    const third = call(mw, req("1.1.1.1"));
    expect(third.passed).toBe(false);
    expect(third.r.statusCode).toBe(429);
    expect(Number(third.r.headers["Retry-After"])).toBeGreaterThan(0);
  });
  it("counts signed-in users per account and others per IP", () => {
    const mw = rateLimit({ name: "t", limit: 1, windowMs: 60_000 });
    expect(call(mw, req("1.1.1.1", "user-a")).passed).toBe(true);
    expect(call(mw, req("1.1.1.1", "user-b")).passed).toBe(true); // same IP, another account
    expect(call(mw, req("2.2.2.2", "user-a")).passed).toBe(false); // same account from another IP
    expect(call(mw, req("3.3.3.3")).passed).toBe(true);
  });
  it("starts a fresh window afterwards", () => {
    vi.useFakeTimers();
    const mw = rateLimit({ name: "t", limit: 1, windowMs: 1_000 });
    expect(call(mw, req("1.1.1.1")).passed).toBe(true);
    expect(call(mw, req("1.1.1.1")).passed).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(call(mw, req("1.1.1.1")).passed).toBe(true);
  });
});
