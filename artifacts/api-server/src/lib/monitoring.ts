import { randomUUID } from "node:crypto";
import { logger } from "./logger";

/**
 * Error monitoring. Every error is written to the server log (with its request id); when SENTRY_DSN is set it is also
 * sent to Sentry (EU region) or a Sentry-compatible server such as GlitchTip, through the documented envelope API.
 * No SDK and no browser script: browser crashes come to POST /api/client-errors and are forwarded from here, so the
 * strict CSP stays as it is and every field that leaves the server is listed in `buildEnvelope`.
 * Nothing personal is sent: no user, cookies, headers, IP or query strings, and messages are scrubbed (`scrub`).
 */

export type ErrorReport = {
  source: "server" | "browser";
  /** Error class name, e.g. "TypeError". */
  type: string;
  message: string;
  stack?: string;
  /** The server request id, or the browser report's own id. */
  requestId?: string;
  method?: string;
  /** Path only; query strings are dropped. */
  path?: string;
  /** For browser reports: error, unhandledrejection, boundary or test. */
  kind?: string;
};

/** Removes what could identify a person: email addresses, tokens and long digit runs (phone, card, account numbers). */
export function scrub(text: string, max: number): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
    .replace(/\b(sb_(secret|publishable)_|re_|whsec_)[\w-]+/g, "[secret]")
    // Dates (2026-10-31) are kept: they help and identify no one.
    .replace(/\d[\d -]{5,}\d/g, (m) => (/^\d{4}-\d{2}-\d{2}$/.test(m) || m.replace(/\D/g, "").length < 7 ? m : "[number]"))
    .slice(0, max);
}

/** `https://<key>@<host>[/<prefix>]/<project>` → where to send envelopes. Throws on a malformed DSN. */
export function parseDsn(dsn: string) {
  const u = new URL(dsn);
  const parts = u.pathname.split("/").filter(Boolean);
  const project = parts.pop();
  if (!/^https?:$/.test(u.protocol) || !u.username || !project || !/^\d+$/.test(project)) throw new Error("SENTRY_DSN is not a valid DSN");
  const prefix = parts.length ? `/${parts.join("/")}` : "";
  return { key: u.username, host: u.host, envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/` };
}

type Frame = { function?: string; filename?: string; lineno?: number; colno?: number };
/** V8 ("at fn (file:1:2)") and Firefox/Safari ("fn@file:1:2") stack lines → Sentry frames, oldest call first. */
export function parseStack(stack: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of stack.split("\n")) {
    const v8 = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
    const gecko = !v8 && line.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
    const m = v8 || gecko;
    if (!m) continue;
    frames.push({ ...(m[1] ? { function: m[1] } : {}), filename: m[2]!.replace(/\?.*$/, ""), lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames.reverse();
}

export function buildEnvelope(r: ErrorReport, opts: { dsn: string; eventId: string; now: Date; environment: string; release?: string }) {
  // Browser crash screens append React's component stack; Sentry shows it under contexts.react, like its React SDK.
  const [jsStack, componentStack] = (r.stack ?? "").split("\nComponent stack:");
  const frames = jsStack ? parseStack(jsStack) : [];
  const event = {
    event_id: opts.eventId,
    timestamp: opts.now.getTime() / 1000,
    platform: r.source === "browser" ? "javascript" : "node",
    level: "error",
    logger: r.source,
    environment: opts.environment,
    ...(opts.release ? { release: opts.release } : {}),
    exception: { values: [{ type: r.type, value: r.message, ...(frames.length ? { stacktrace: { frames } } : {}) }] },
    tags: { source: r.source, ...(r.requestId ? { request_id: r.requestId } : {}), ...(r.kind ? { kind: r.kind } : {}) },
    ...(r.path ? { request: { ...(r.method ? { method: r.method } : {}), url: r.path } } : {}),
    ...(componentStack?.trim() ? { contexts: { react: { componentStack: componentStack.trim() } } } : {}),
  };
  return [
    JSON.stringify({ event_id: opts.eventId, sent_at: opts.now.toISOString(), dsn: opts.dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n") + "\n";
}

const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";
const release = process.env.APP_RELEASE || undefined;
let target: ReturnType<typeof parseDsn> | null = null;
const rawDsn = process.env.SENTRY_DSN?.trim();
if (rawDsn) {
  try { target = parseDsn(rawDsn); } catch { logger.error("SENTRY_DSN is set but is not a valid DSN; errors go to the log only"); }
}
/** For the admin settings page: where errors go. */
export const monitoringStatus = () => ({ sentry: target !== null, sentryHost: target?.host ?? null, environment, release: release ?? null });

const pending = new Set<Promise<void>>();

/** Forwards one report to Sentry when configured (never throws, never blocks the response). Returns its event id. */
export function forwardError(r: ErrorReport): string {
  const eventId = randomUUID().replaceAll("-", "");
  if (!target || !rawDsn) return eventId;
  const report = { ...r, message: scrub(r.message, 1000), ...(r.stack ? { stack: scrub(r.stack, 8000) } : {}), ...(r.path ? { path: r.path.split("?")[0]!.slice(0, 300) } : {}) };
  const body = buildEnvelope(report, { dsn: rawDsn, eventId, now: new Date(), environment, release });
  const sent = fetch(target.envelopeUrl, {
    method: "POST",
    headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${target.key}, sentry_client=grantapp/1.0` },
    body,
    signal: AbortSignal.timeout(5000),
  }).then((res) => {
    if (!res.ok) logger.warn({ status: res.status, eventId }, "Sentry refused an error report");
  }, (err: unknown) => {
    logger.warn({ err: String(err), eventId }, "Could not send an error report to Sentry");
  }).finally(() => pending.delete(sent));
  pending.add(sent);
  return eventId;
}

/** Waits (up to `ms`) for reports still being sent, e.g. before the process exits after a crash. */
export async function flushReports(ms = 3000) {
  await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, ms))]);
}

/** Short form of a request id that users can quote; the log has the full id, so it can be found by prefix. */
export const shortReference = (id: string) => id.replaceAll("-", "").slice(0, 8);
