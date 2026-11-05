import net from "node:net";
import tls from "node:tls";

/**
 * A minimal Redis client (RESP2 over one TCP or TLS connection), enough for the shared rate-limit counters: no new
 * dependency, like the ClamAV and Sentry code. Commands are pipelined in order on one connection.
 *
 * It never makes a caller wait for long: a command fails at once while the connection is down (a reconnect is tried
 * again after a short pause, up to 10 s), and after `commandTimeoutMs` if Redis doesn't answer. A timeout drops the
 * connection, because replies to commands that were given up on would otherwise be read as the answers to later ones.
 */

export type RedisReply = string | number | null | RedisReply[];
export class RedisReplyError extends Error {}
export class RedisUnavailableError extends Error {}

export type RedisOptions = { connectTimeoutMs?: number; commandTimeoutMs?: number };

/** `redis://[user:password@]host[:port][/db]` or `rediss://` (TLS). Throws on anything else. */
export function parseRedisUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") throw new Error("RATE_LIMIT_REDIS_URL must start with redis:// or rediss://");
  if (!url.hostname) throw new Error("RATE_LIMIT_REDIS_URL has no host");
  const port = url.port ? Number(url.port) : 6379;
  const db = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isInteger(db) || db < 0) throw new Error("RATE_LIMIT_REDIS_URL: the database after / must be a number");
  return {
    tls: url.protocol === "rediss:",
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port,
    db,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    /** For display: never includes the password. */
    display: `${url.protocol}//${url.hostname}:${port}${db ? `/${db}` : ""}`,
  };
}

export function encodeCommand(args: (string | number)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.from(String(a));
    parts.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from("\r\n"));
  }
  return Buffer.concat(parts);
}

/** Reads one reply starting at `at`. Returns undefined when the buffer doesn't hold a whole reply yet. */
export function parseReply(buf: Buffer, at = 0): { value: RedisReply | RedisReplyError; next: number } | undefined {
  const eol = buf.indexOf("\r\n", at);
  if (eol < 0) return undefined;
  const type = String.fromCharCode(buf[at]!);
  const line = buf.toString("utf8", at + 1, eol);
  const after = eol + 2;
  switch (type) {
    case "+": return { value: line, next: after };
    case "-": return { value: new RedisReplyError(line), next: after };
    case ":": return { value: Number(line), next: after };
    case "$": {
      const len = Number(line);
      if (len < 0) return { value: null, next: after };
      if (buf.length < after + len + 2) return undefined;
      return { value: buf.toString("utf8", after, after + len), next: after + len + 2 };
    }
    case "*": {
      const n = Number(line);
      if (n < 0) return { value: null, next: after };
      const items: RedisReply[] = [];
      let pos = after;
      for (let i = 0; i < n; i++) {
        const r = parseReply(buf, pos);
        if (!r) return undefined;
        if (r.value instanceof RedisReplyError) throw r.value;
        items.push(r.value);
        pos = r.next;
      }
      return { value: items, next: pos };
    }
    default: throw new Error(`Unexpected reply from Redis (type byte ${JSON.stringify(type)})`);
  }
}

type Pending = { resolve: (v: RedisReply) => void; reject: (e: Error) => void; settled: boolean };

export class RedisClient {
  private readonly cfg: ReturnType<typeof parseRedisUrl>;
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private sock: net.Socket | undefined;
  private ready = false;
  private connecting: Promise<void> | undefined;
  private queue: Pending[] = [];
  private buf: Buffer = Buffer.alloc(0);
  private retryAt = 0;
  private backoffMs = 0;
  private closed = false;
  /** The last connection or command problem, for Admin Settings. Cleared once a connection is ready. */
  lastError: string | null = null;

  constructor(url: string, opts: RedisOptions = {}) {
    this.cfg = parseRedisUrl(url);
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 1000;
    this.commandTimeoutMs = opts.commandTimeoutMs ?? 250;
  }

  get display() { return this.cfg.display; }
  get isReady() { return this.ready; }

  async command(args: (string | number)[]): Promise<RedisReply> {
    if (this.closed) throw new RedisUnavailableError("Redis client closed");
    if (!this.ready) await this.connect();
    return this.send(args, this.commandTimeoutMs);
  }

  close() {
    this.closed = true;
    this.drop("closed");
  }

  private connect(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (Date.now() < this.retryAt) return Promise.reject(new RedisUnavailableError(this.lastError ?? "Redis not reachable"));
    this.connecting = new Promise<void>((resolve, reject) => {
      const { host, port } = this.cfg;
      const sock = this.cfg.tls ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host }) : net.createConnection({ host, port });
      this.sock = sock;
      sock.setNoDelay(true);
      const timer = setTimeout(() => { fail(new RedisUnavailableError(`no connection within ${this.connectTimeoutMs} ms`)); }, this.connectTimeoutMs);
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (current()) this.drop(err.message); else sock.destroy();
        reject(err instanceof RedisUnavailableError ? err : new RedisUnavailableError(err.message));
      };
      // Events from a connection that has already been replaced are ignored.
      const current = () => this.sock === sock;
      sock.on("data", (chunk: Buffer) => { if (current()) this.onData(chunk); });
      sock.on("error", (err) => { if (!settled) fail(err); else if (current()) this.drop(err.message); });
      sock.on("close", () => { if (!settled) fail(new Error("connection closed")); else if (current()) this.drop("connection closed"); });
      sock.once(this.cfg.tls ? "secureConnect" : "connect", async () => {
        try {
          const { username, password, db } = this.cfg;
          const setup: Promise<RedisReply>[] = [];
          if (password) setup.push(this.send(username ? ["AUTH", username, password] : ["AUTH", password], this.connectTimeoutMs));
          if (db) setup.push(this.send(["SELECT", db], this.connectTimeoutMs));
          setup.push(this.send(["PING"], this.connectTimeoutMs));
          await Promise.all(setup);
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.ready = true;
          this.backoffMs = 0;
          this.lastError = null;
          resolve();
        } catch (err) {
          fail(err as Error);
        }
      });
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private send(args: (string | number)[], timeoutMs: number): Promise<RedisReply> {
    const sock = this.sock;
    if (!sock || sock.destroyed) return Promise.reject(new RedisUnavailableError(this.lastError ?? "Redis not connected"));
    return new Promise<RedisReply>((resolve, reject) => {
      const entry: Pending = { resolve, reject, settled: false };
      const timer = setTimeout(() => {
        if (entry.settled) return;
        // The reply may still come; reading it as the next command's answer would be wrong, so start over.
        this.drop(`no answer within ${timeoutMs} ms`);
      }, timeoutMs);
      entry.resolve = (v) => { clearTimeout(timer); entry.settled = true; resolve(v); };
      entry.reject = (e) => { clearTimeout(timer); entry.settled = true; reject(e); };
      this.queue.push(entry);
      sock.write(encodeCommand(args));
    });
  }

  private onData(chunk: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    let pos = 0;
    for (;;) {
      let r: ReturnType<typeof parseReply>;
      try { r = parseReply(this.buf, pos); } catch (err) { this.drop((err as Error).message); return; }
      if (!r) break;
      pos = r.next;
      const entry = this.queue.shift();
      if (!entry || entry.settled) continue;
      if (r.value instanceof RedisReplyError) entry.reject(r.value); else entry.resolve(r.value);
    }
    this.buf = pos >= this.buf.length ? Buffer.alloc(0) : this.buf.subarray(pos);
  }

  /** Closes the connection, fails everything waiting, and waits a little before the next connection attempt. */
  private drop(reason: string) {
    const wasUp = this.ready || !!this.sock;
    this.ready = false;
    const sock = this.sock;
    this.sock = undefined;
    if (sock && !sock.destroyed) sock.destroy();
    this.buf = Buffer.alloc(0);
    const waiting = this.queue;
    this.queue = [];
    for (const e of waiting) if (!e.settled) e.reject(new RedisUnavailableError(reason));
    if (wasUp && !this.closed) {
      this.lastError = reason;
      this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : 1000, 10_000);
      this.retryAt = Date.now() + this.backoffMs;
    }
  }
}
