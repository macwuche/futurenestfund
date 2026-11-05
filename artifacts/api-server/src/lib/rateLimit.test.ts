import net from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { FallbackStore, HIT_SCRIPT, MemoryStore, RedisStore, rateLimit, rateLimitStatus, type CounterStore } from "./rateLimit";
import { RedisClient, encodeCommand, parseRedisUrl, parseReply } from "./redisClient";

const req = (ip: string, authUserId?: string) => ({ ip, identity: authUserId ? { authUserId } : undefined }) as unknown as Request;
const res = () => {
  const r = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown,
    setHeader(k: string, v: string) { r.headers[k] = v; }, status(c: number) { r.statusCode = c; return r; }, json(b: unknown) { r.body = b; return r; } };
  return r;
};
const call = async (mw: ReturnType<typeof rateLimit>, rq: Request) => { const r = res(); let passed = false; await mw(rq, r as unknown as Response, () => { passed = true; }); return { passed, r }; };

/**
 * A stand-in that speaks the Redis protocol, enough for the limiter: AUTH, SELECT, PING and EVAL of the hit script
 * (INCR + PEXPIRE + PTTL, done here in one step like Redis does). `pause` stops it answering; `close` drops clients.
 */
function fakeRedis(opts: { password?: string } = {}) {
  const data = new Map<string, { n: number; expiresAt: number }>();
  const sockets = new Set<net.Socket>();
  const state = { paused: false, commands: [] as string[][] };
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    let buf: Buffer = Buffer.alloc(0);
    let authed = !opts.password;
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk as Buffer]);
      for (;;) {
        const r = parseReply(buf);
        if (!r) break;
        buf = buf.subarray(r.next);
        const args = (r.value as string[]).map(String);
        state.commands.push(args);
        if (state.paused) continue;
        const cmd = args[0]!.toUpperCase();
        const out = (s: string) => sock.write(s);
        if (cmd === "AUTH") { authed = args.at(-1) === opts.password; out(authed ? "+OK\r\n" : "-WRONGPASS invalid username-password pair\r\n"); continue; }
        if (!authed) { out("-NOAUTH Authentication required.\r\n"); continue; }
        if (cmd === "PING") out("+PONG\r\n");
        else if (cmd === "SELECT") out("+OK\r\n");
        else if (cmd === "EVAL" && args[1] === HIT_SCRIPT) {
          const key = args[3]!, ms = Number(args[4]), now = Date.now();
          let e = data.get(key);
          if (!e || e.expiresAt <= now) { e = { n: 0, expiresAt: now + ms }; data.set(key, e); }
          e.n++;
          out(`*2\r\n:${e.n}\r\n:${e.expiresAt - now}\r\n`);
        } else out(`-ERR unknown command '${cmd}'\r\n`);
      }
    });
  });
  return {
    state, data,
    listen: () => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port))),
    dropClients: () => { for (const s of sockets) s.destroy(); },
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("rateLimit (memory)", () => {
  it("allows up to the limit, then answers 429 with Retry-After", async () => {
    const mw = rateLimit({ name: "t", limit: 2, windowMs: 60_000, store: new MemoryStore() });
    expect((await call(mw, req("1.1.1.1"))).passed).toBe(true);
    expect((await call(mw, req("1.1.1.1"))).passed).toBe(true);
    const third = await call(mw, req("1.1.1.1"));
    expect(third.passed).toBe(false);
    expect(third.r.statusCode).toBe(429);
    expect(Number(third.r.headers["Retry-After"])).toBeGreaterThan(0);
    expect(third.r.headers["RateLimit-Remaining"]).toBe("0");
  });
  it("counts signed-in users per account and others per IP", async () => {
    const mw = rateLimit({ name: "t", limit: 1, windowMs: 60_000, store: new MemoryStore() });
    expect((await call(mw, req("1.1.1.1", "user-a"))).passed).toBe(true);
    expect((await call(mw, req("1.1.1.1", "user-b"))).passed).toBe(true); // same IP, another account
    expect((await call(mw, req("2.2.2.2", "user-a"))).passed).toBe(false); // same account from another IP
    expect((await call(mw, req("3.3.3.3"))).passed).toBe(true);
  });
  it("starts a fresh window afterwards", async () => {
    vi.useFakeTimers();
    const mw = rateLimit({ name: "t", limit: 1, windowMs: 1_000, store: new MemoryStore() });
    expect((await call(mw, req("1.1.1.1"))).passed).toBe(true);
    expect((await call(mw, req("1.1.1.1"))).passed).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect((await call(mw, req("1.1.1.1"))).passed).toBe(true);
  });
  it("keeps limiters apart in one store (their names are part of the key)", async () => {
    const store = new MemoryStore();
    const a = rateLimit({ name: "a", limit: 1, windowMs: 60_000, store });
    const b = rateLimit({ name: "b", limit: 1, windowMs: 60_000, store });
    expect((await call(a, req("1.1.1.1"))).passed).toBe(true);
    expect((await call(b, req("1.1.1.1"))).passed).toBe(true);
    expect((await call(a, req("1.1.1.1"))).passed).toBe(false);
  });
});

describe("shared counts", () => {
  it("two servers sharing one store enforce one limit between them", async () => {
    const shared = new MemoryStore();
    const server1 = rateLimit({ name: "w", limit: 3, windowMs: 60_000, store: shared });
    const server2 = rateLimit({ name: "w", limit: 3, windowMs: 60_000, store: shared });
    const results = [await call(server1, req("1.1.1.1", "u")), await call(server2, req("1.1.1.1", "u")), await call(server1, req("1.1.1.1", "u")), await call(server2, req("1.1.1.1", "u"))];
    expect(results.map((x) => x.passed)).toEqual([true, true, true, false]);
  });
  it("falls back to memory when the store throws, and warns at most once a minute", async () => {
    vi.useFakeTimers();
    const broken = { hit: () => Promise.reject(new Error("boom")), client: { display: "redis://x:6379", lastError: "boom", isReady: false, command: () => Promise.reject(new Error("boom")) } } as unknown as RedisStore;
    const warn = vi.fn();
    const store = new FallbackStore(broken, warn);
    const mw = rateLimit({ name: "t", limit: 1, windowMs: 60_000, store });
    expect((await call(mw, req("1.1.1.1"))).passed).toBe(true); // never refused because Redis is down
    expect((await call(mw, req("1.1.1.1"))).passed).toBe(false); // still limited, per server
    expect(warn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    await call(mw, req("1.1.1.1"));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(store.lastError).toBe("boom");
  });
  it("reports memory when no Redis is configured", async () => {
    expect(await rateLimitStatus(new MemoryStore() as CounterStore)).toEqual({ store: "memory", ok: true, address: null, error: null });
  });
});

describe("Redis protocol", () => {
  it("encodes commands and parses every reply type", () => {
    expect(encodeCommand(["EVAL", "x", 1, "k"]).toString()).toBe("*4\r\n$4\r\nEVAL\r\n$1\r\nx\r\n$1\r\n1\r\n$1\r\nk\r\n");
    expect(parseReply(Buffer.from("+PONG\r\n"))?.value).toBe("PONG");
    expect(parseReply(Buffer.from(":42\r\n"))?.value).toBe(42);
    expect(parseReply(Buffer.from("$-1\r\n"))?.value).toBeNull();
    expect(parseReply(Buffer.from("$3\r\nabc\r\n"))?.value).toBe("abc");
    expect(parseReply(Buffer.from("*2\r\n:1\r\n:59999\r\n"))?.value).toEqual([1, 59999]);
    expect((parseReply(Buffer.from("-ERR nope\r\n"))?.value as Error).message).toBe("ERR nope");
    expect(parseReply(Buffer.from("*2\r\n:1\r\n"))).toBeUndefined(); // incomplete
    expect(parseReply(Buffer.from("$3\r\nab"))).toBeUndefined();
  });
  it("reads the URL without ever showing the password", () => {
    const u = parseRedisUrl("rediss://default:s%40cret@redis.example.com:6380/2");
    expect(u).toMatchObject({ tls: true, host: "redis.example.com", port: 6380, db: 2, username: "default", password: "s@cret" });
    expect(u.display).toBe("rediss://redis.example.com:6380/2");
    expect(parseRedisUrl("redis://127.0.0.1")).toMatchObject({ port: 6379, db: 0, password: undefined });
    expect(() => parseRedisUrl("http://x")).toThrow(/redis:\/\//);
  });
});

describe("RedisStore against a Redis stand-in", () => {
  const fake = fakeRedis({ password: "pw" });
  let port = 0;
  beforeAll(async () => { port = await fake.listen(); });
  afterAll(async () => { await fake.close(); });

  it("authenticates, counts atomically per key and shares counts between clients", async () => {
    const c1 = new RedisClient(`redis://:pw@127.0.0.1:${port}/1`);
    const c2 = new RedisClient(`redis://:pw@127.0.0.1:${port}/1`);
    const s1 = new RedisStore(c1), s2 = new RedisStore(c2);
    const counts = await Promise.all([s1.hit("w:u", 60_000), s2.hit("w:u", 60_000), s1.hit("w:u", 60_000), s2.hit("w:v", 60_000)]);
    expect(counts.map((h) => h.count).sort()).toEqual([1, 1, 2, 3]);
    expect(counts[0]!.resetAt).toBeGreaterThan(Date.now() + 59_000);
    expect(fake.data.has("fnf:rl:w:u")).toBe(true);
    expect(fake.state.commands.some((a) => a[0] === "AUTH" && a[1] === "pw")).toBe(true);
    expect(fake.state.commands.some((a) => a[0] === "SELECT" && a[1] === "1")).toBe(true);
    c1.close(); c2.close();
  });
  it("refuses a wrong password, and Settings shows the reason", async () => {
    const c = new RedisClient(`redis://:nope@127.0.0.1:${port}`);
    const store = new FallbackStore(new RedisStore(c), () => {});
    const h = await store.hit("t:x", 60_000);
    expect(h.count).toBe(1); // counted in memory
    expect(store.lastError).toMatch(/WRONGPASS/);
    const st = await rateLimitStatus(store);
    expect(st).toMatchObject({ store: "redis", ok: false, address: `redis://127.0.0.1:${port}` });
    expect(st.error).toMatch(/WRONGPASS/);
    c.close();
  });
  it("gives up quickly when Redis stops answering, then reconnects", async () => {
    const c = new RedisClient(`redis://:pw@127.0.0.1:${port}`, { commandTimeoutMs: 100 });
    const store = new FallbackStore(new RedisStore(c), () => {});
    expect((await store.hit("t:y", 60_000)).count).toBe(1);
    fake.state.paused = true;
    const started = Date.now();
    expect((await store.hit("t:y", 60_000)).count).toBe(1); // memory count, after the timeout
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(store.lastError).toMatch(/no answer within 100 ms/);
    // While waiting to reconnect, requests don't wait at all.
    const quick = Date.now();
    await store.hit("t:y", 60_000);
    expect(Date.now() - quick).toBeLessThan(50);
    fake.state.paused = false;
    await new Promise((r) => setTimeout(r, 1_100)); // first reconnect pause is 1 s
    expect((await store.hit("t:y", 60_000)).count).toBe(2); // back on the shared count: 1 before the pause, this one now
    c.close();
  });
  it("survives the connection being cut", async () => {
    const c = new RedisClient(`redis://:pw@127.0.0.1:${port}`);
    const store = new RedisStore(c);
    await store.hit("t:z", 60_000);
    fake.dropClients();
    await new Promise((r) => setTimeout(r, 1_100));
    expect((await store.hit("t:z", 60_000)).count).toBe(2);
    c.close();
  });
  it("can't reach a closed port: fails fast, status says why", async () => {
    const c = new RedisClient("redis://127.0.0.1:1");
    const store = new FallbackStore(new RedisStore(c), () => {});
    expect((await store.hit("t:q", 60_000)).count).toBe(1);
    const st = await rateLimitStatus(store);
    expect(st.ok).toBe(false);
    expect(st.error).toMatch(/ECONNREFUSED|not reachable/);
    c.close();
  });
});

/** Against a real Redis when TEST_REDIS_URL is set (e.g. redis://127.0.0.1:6390); skipped otherwise. */
describe.skipIf(!process.env["TEST_REDIS_URL"])("RedisStore against a real Redis", () => {
  it("counts, expires and shares like the stand-in", async () => {
    const url = process.env["TEST_REDIS_URL"]!;
    const c1 = new RedisClient(url), c2 = new RedisClient(url);
    const prefix = `fnf:test:${Date.now()}:`;
    const s1 = new RedisStore(c1, prefix), s2 = new RedisStore(c2, prefix);
    const hits = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? s1 : s2).hit("w:u", 1_000)));
    expect(hits.map((h) => h.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await c1.command(["PTTL", `${prefix}w:u`])).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1_100));
    expect((await s1.hit("w:u", 1_000)).count).toBe(1);
    expect(await rateLimitStatus(new FallbackStore(s1))).toMatchObject({ store: "redis", ok: true, error: null });
    c1.close(); c2.close();
  });
});
