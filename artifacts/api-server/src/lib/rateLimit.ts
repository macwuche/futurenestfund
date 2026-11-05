import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger";
import { RedisClient } from "./redisClient";

/**
 * Fixed-window rate limits. Signed-in callers are counted per account, everyone else per IP address (set TRUST_PROXY
 * behind nginx so req.ip is the visitor's, not the proxy's).
 *
 * Where the counts live (Phase 9.2):
 * - by default in this process's memory: right for one API server;
 * - with RATE_LIMIT_REDIS_URL set, in Redis, so every API server shares one count per caller and the limits hold
 *   across all of them. One atomic step per request (a Lua script: INCR, and PEXPIRE on the first hit).
 * If Redis doesn't answer, that request is counted in memory instead (limits become per server until Redis is back)
 * and a warning is logged at most once a minute: traffic is never refused because the counter store is down.
 */

export type Hit = { count: number; resetAt: number };
export interface CounterStore {
  /** Adds one hit to `key` and returns the count in the current window and when that window ends. */
  hit(key: string, windowMs: number): Promise<Hit>;
}

export class MemoryStore implements CounterStore {
  private hits = new Map<string, Hit>();
  private lastSweep = Date.now();
  async hit(key: string, windowMs: number): Promise<Hit> { return this.hitNow(key, windowMs); }
  hitNow(key: string, windowMs: number): Hit {
    const now = Date.now();
    if (now - this.lastSweep > 60_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
      this.lastSweep = now;
    }
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) { entry = { count: 0, resetAt: now + windowMs }; this.hits.set(key, entry); }
    entry.count++;
    return { ...entry };
  }
}

/** INCR the key; start its window on the first hit (or if it somehow has no expiry); return [count, ms left]. */
export const HIT_SCRIPT = `local c = redis.call('INCR', KEYS[1])
local t = redis.call('PTTL', KEYS[1])
if c == 1 or t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); t = tonumber(ARGV[1]) end
return {c, t}`;

type RedisLike = Pick<RedisClient, "command" | "display" | "isReady" | "lastError">;

export class RedisStore implements CounterStore {
  constructor(readonly client: RedisLike, readonly prefix = "fnf:rl:") {}
  async hit(key: string, windowMs: number): Promise<Hit> {
    const reply = await this.client.command(["EVAL", HIT_SCRIPT, 1, this.prefix + key, windowMs]);
    if (!Array.isArray(reply) || typeof reply[0] !== "number" || typeof reply[1] !== "number") throw new Error("Unexpected answer from Redis");
    return { count: reply[0], resetAt: Date.now() + Math.max(0, reply[1]) };
  }
}

/** Redis first; memory for any request Redis can't count. Remembers the last failure for Admin Settings. */
export class FallbackStore implements CounterStore {
  readonly memory = new MemoryStore();
  lastFailureAt = 0;
  lastError: string | null = null;
  private lastWarnAt = 0;
  constructor(readonly primary: RedisStore, private readonly warn: (msg: string, err: string) => void = defaultWarn) {}
  async hit(key: string, windowMs: number): Promise<Hit> {
    try {
      return await this.primary.hit(key, windowMs);
    } catch (err) {
      const now = Date.now();
      this.lastFailureAt = now;
      this.lastError = (err as Error).message;
      if (now - this.lastWarnAt >= 60_000) {
        this.lastWarnAt = now;
        this.warn("Rate-limit store (Redis) not answering; counting in this server's memory until it's back", this.lastError);
      }
      return this.memory.hitNow(key, windowMs);
    }
  }
}
const defaultWarn = (msg: string, err: string) => logger.warn({ err }, msg);

let sharedStore: CounterStore | undefined;
/** The store every limiter uses unless given its own: chosen once from RATE_LIMIT_REDIS_URL. */
export function defaultStore(env: NodeJS.ProcessEnv = process.env): CounterStore {
  if (sharedStore) return sharedStore;
  const url = env["RATE_LIMIT_REDIS_URL"]?.trim();
  if (!url) return (sharedStore = new MemoryStore());
  try {
    const client = new RedisClient(url, { commandTimeoutMs: n(env["RATE_LIMIT_REDIS_TIMEOUT_MS"], 250) });
    const prefix = env["RATE_LIMIT_REDIS_PREFIX"]?.trim() || "fnf:rl:";
    sharedStore = new FallbackStore(new RedisStore(client, prefix));
    logger.info({ redis: client.display, prefix }, "Rate limits shared through Redis");
  } catch (err) {
    // A malformed URL shouldn't stop the API; it runs on memory counts and says so in the log and in Settings.
    logger.error({ err: (err as Error).message }, "RATE_LIMIT_REDIS_URL is not usable; rate limits use memory");
    configError = (err as Error).message;
    sharedStore = new MemoryStore();
  }
  return sharedStore;
}
let configError: string | null = null;

export type RateLimitStatus = {
  store: "memory" | "redis";
  /** redis: the last request was counted in Redis (no failure in the last minute) */
  ok: boolean;
  address: string | null;
  error: string | null;
};
/** For Admin Settings → Monitoring. Asks Redis directly (PING) so the answer is current even on a quiet server. */
export async function rateLimitStatus(store: CounterStore = defaultStore()): Promise<RateLimitStatus> {
  if (!(store instanceof FallbackStore)) return { store: "memory", ok: !configError, address: null, error: configError };
  const client = store.primary.client;
  try {
    await client.command(["PING"]);
    return { store: "redis", ok: true, address: client.display, error: null };
  } catch (err) {
    return { store: "redis", ok: false, address: client.display, error: client.lastError ?? (err as Error).message };
  }
}

export function rateLimit({ name, limit, windowMs, key, store }: { name: string; limit: number; windowMs: number; key?: (req: Request) => string; store?: CounterStore }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const now = Date.now();
    const who = key?.(req) ?? (req.identity?.authUserId ? `user:${req.identity.authUserId}` : `ip:${req.ip}`);
    const entry = await (store ?? defaultStore()).hit(`${name}:${who}`, windowMs);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
    if (entry.count > limit) {
      const retry = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retry));
      req.log?.warn({ limiter: name, who }, "Rate limit exceeded");
      res.status(429).json({ error: `Too many requests. Please wait ${retry} second${retry === 1 ? "" : "s"} and try again.` });
      return;
    }
    next();
  };
}

const n = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
const MIN = 60_000;
/** Every /api request, per IP: stops floods before any token or database work. */
export const perIp = rateLimit({ name: "ip", limit: n(process.env.RATE_LIMIT_IP_PER_MIN, 600), windowMs: MIN, key: (req) => `ip:${req.ip}` });
/** Changes (POST/PATCH/PUT/DELETE), per signed-in account. */
export const perUserWrites = rateLimit({ name: "writes", limit: n(process.env.RATE_LIMIT_WRITES_PER_MIN, 60), windowMs: MIN });
/** File uploads, per account: the expensive requests (image re-encoding, PDF checks). */
export const perUserUploads = rateLimit({ name: "uploads", limit: n(process.env.RATE_LIMIT_UPLOADS_PER_10MIN, 20), windowMs: 10 * MIN });
/** The Supabase Send Email Hook, per IP. */
export const hookLimit = rateLimit({ name: "email-hook", limit: n(process.env.RATE_LIMIT_HOOK_PER_MIN, 120), windowMs: MIN, key: (req) => `hook:${req.ip}` });
