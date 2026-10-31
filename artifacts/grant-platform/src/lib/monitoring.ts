/**
 * Browser crash reporting. Errors go to our own API (POST /api/client-errors), which logs them and, when the server
 * has SENTRY_DSN set, forwards them with personal data scrubbed. No third-party script runs in the page.
 * At most 10 reports per page load, and each distinct error once, so a render loop can't flood the server.
 */
export type ClientErrorKind = 'error' | 'unhandledrejection' | 'boundary' | 'test';

const MAX_PER_PAGE = 10;
let sent = 0;
const seen = new Set<string>();

const asError = (v: unknown): Error => (v instanceof Error ? v : new Error(typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })()));

/** Sends one report; resolves to the short reference to show the user, or null if it wasn't sent. */
export async function reportClientError(kind: ClientErrorKind, value: unknown, extraStack = ''): Promise<string | null> {
  const e = asError(value);
  const key = `${kind}:${e.name}:${e.message}`;
  if (kind !== 'test' && (seen.has(key) || sent >= MAX_PER_PAGE)) return null;
  seen.add(key);
  sent++;
  const body = {
    kind,
    type: e.name.slice(0, 100),
    message: (e.message || 'Unknown error').slice(0, 1000),
    ...(e.stack || extraStack ? { stack: `${e.stack ?? ''}${extraStack}`.slice(0, 8000) } : {}),
    path: location.pathname.slice(0, 300),
  };
  try {
    const res = await fetch('/api/client-errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true, credentials: 'same-origin' });
    if (!res.ok) return null;
    return ((await res.json()) as { reference?: string }).reference ?? null;
  } catch {
    return null; // offline, or the API itself is down: nothing more we can do from here
  }
}

/** Uncaught errors and rejected promises anywhere in the page. Call once at start-up. */
export function installErrorReporting() {
  window.addEventListener('error', (ev) => {
    // Resource load failures (an <img> 404) have no error object and aren't crashes.
    if (!ev.error && !ev.message) return;
    void reportClientError('error', ev.error ?? ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => { void reportClientError('unhandledrejection', ev.reason); });
}
