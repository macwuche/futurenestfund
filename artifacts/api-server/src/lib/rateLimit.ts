import type { NextFunction, Request, Response } from "express";

/**
 * Fixed-window rate limits kept in this process's memory (enough for one server; several servers behind a load balancer
 * would need a shared store such as Redis). Signed-in callers are counted per account, everyone else per IP address
 * (set TRUST_PROXY behind nginx so req.ip is the visitor's, not the proxy's).
 */
export function rateLimit({ name, limit, windowMs, key }: { name: string; limit: number; windowMs: number; key?: (req: Request) => string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = Date.now();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      lastSweep = now;
    }
    const who = key?.(req) ?? (req.identity?.authUserId ? `user:${req.identity.authUserId}` : `ip:${req.ip}`);
    let entry = hits.get(who);
    if (!entry || entry.resetAt <= now) { entry = { count: 0, resetAt: now + windowMs }; hits.set(who, entry); }
    entry.count++;
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
    if (entry.count > limit) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
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
