import net from "node:net";

/**
 * Virus scanning of uploads through a ClamAV daemon (clamd), using its INSTREAM command: the bytes are streamed over
 * the socket, so nothing is written to disk before it's been checked and clamd needs no access to the upload folder.
 *
 * Off unless CLAMAV_SOCKET (e.g. /run/clamav/clamd.ctl) or CLAMAV_HOST (+ CLAMAV_PORT, default 3310) is set.
 * When on, it fails closed: if clamd can't be reached, uploads are refused (503) rather than accepted unchecked.
 * CLAMAV_FAIL_OPEN=1 accepts them instead, with a warning in the log.
 */

export class VirusFoundError extends Error {
  constructor(readonly signature: string) { super(`Virus scanner flagged the file: ${signature}`); }
}
export class ScanUnavailableError extends Error {}

type Target = { path: string } | { host: string; port: number };

export function scanTarget(env: NodeJS.ProcessEnv = process.env): Target | null {
  const socket = env["CLAMAV_SOCKET"]?.trim();
  if (socket) return { path: socket };
  const host = env["CLAMAV_HOST"]?.trim();
  if (!host) return null;
  const port = Number(env["CLAMAV_PORT"] ?? 3310);
  return { host, port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3310 };
}

export const scanFailOpen = (env: NodeJS.ProcessEnv = process.env) => env["CLAMAV_FAIL_OPEN"] === "1";
const timeoutMs = (env: NodeJS.ProcessEnv) => { const n = Number(env["CLAMAV_TIMEOUT_MS"]); return Number.isFinite(n) && n > 0 ? n : 30_000; };
const CHUNK = 64 * 1024;

/** One clamd command over a fresh connection ("z" form: NUL-terminated); resolves with the reply, minus the NUL. */
function clamd(target: Target, command: string, payload: Buffer | undefined, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(target as net.NetConnectOpts);
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (err: Error | null, reply?: string) => {
      if (done) return;
      done = true;
      sock.destroy();
      if (err) reject(err); else resolve(reply!);
    };
    sock.setTimeout(timeoutMs, () => finish(new ScanUnavailableError("The virus scanner did not answer in time.")));
    sock.on("error", (e) => finish(new ScanUnavailableError(`The virus scanner can't be reached (${(e as NodeJS.ErrnoException).code ?? e.message}).`)));
    sock.on("data", (d: Buffer | string) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    sock.on("end", () => finish(null, Buffer.concat(chunks).toString("utf8").replace(/\0+$/, "").trim()));
    sock.on("connect", () => {
      sock.write(`z${command}\0`);
      if (payload) {
        for (let i = 0; i < payload.length; i += CHUNK) {
          const part = payload.subarray(i, i + CHUNK);
          const len = Buffer.alloc(4); len.writeUInt32BE(part.length);
          sock.write(len); sock.write(part);
        }
        sock.write(Buffer.alloc(4)); // zero-length chunk ends the stream
      }
    });
  });
}

/** Reads clamd's answer to INSTREAM: "stream: OK", "stream: <name> FOUND", or "... ERROR". */
export function parseScanReply(reply: string): { clean: true } | { clean: false; signature: string } {
  const r = reply.replace(/^stream:\s*/, "");
  if (r === "OK") return { clean: true };
  const found = /^(.*)\s+FOUND$/.exec(r);
  if (found) return { clean: false, signature: found[1]!.trim().slice(0, 200) };
  throw new ScanUnavailableError(`The virus scanner couldn't check this file (${r.slice(0, 200) || "empty reply"}).`);
}

/** Scan bytes. Returns "skipped" when scanning is off, or when clamd is down and CLAMAV_FAIL_OPEN=1. */
export async function scanBuffer(buf: Buffer, env: NodeJS.ProcessEnv = process.env): Promise<"clean" | "skipped"> {
  const target = scanTarget(env);
  if (!target) return "skipped";
  let reply: string;
  try {
    reply = await clamd(target, "INSTREAM", buf, timeoutMs(env));
  } catch (e) {
    if (scanFailOpen(env)) return "skipped";
    throw e;
  }
  const r = parseScanReply(reply);
  if (!r.clean) throw new VirusFoundError(r.signature);
  return "clean";
}

export type ScanStatus = { enabled: boolean; ok: boolean; failOpen: boolean; version: string | null; error: string | null };

/** For Admin → Settings → Monitoring: whether scanning is on, and clamd's version and signature date. */
export async function scanStatus(env: NodeJS.ProcessEnv = process.env): Promise<ScanStatus> {
  const target = scanTarget(env);
  const failOpen = scanFailOpen(env);
  if (!target) return { enabled: false, ok: false, failOpen, version: null, error: null };
  try {
    const version = await clamd(target, "VERSION", undefined, 5_000);
    return { enabled: true, ok: true, failOpen, version: version.slice(0, 200), error: null };
  } catch (e) {
    return { enabled: true, ok: false, failOpen, version: null, error: (e as Error).message };
  }
}
