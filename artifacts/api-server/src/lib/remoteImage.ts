/**
 * Download an image an administrator linked to (a payment method's logo), once, so it can be stored like an upload.
 *
 * The server makes this request, so it must not become a way to reach internal services (SSRF):
 * - https only; no credentials in the URL; ports 443 (or none)
 * - the host is resolved once, every address is checked against private / internal ranges, and the connection is made to
 *   that same checked address (no second lookup an attacker's DNS could answer differently)
 * - redirects are followed by hand (at most 3), each one checked again
 * - 2 MB and 10 seconds at most
 * `LOGO_URL_ALLOW_PRIVATE=1` (never in production) lifts the address and https checks for local tests.
 */
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class RemoteImageError extends Error {}

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96], ["100::", 64],
] as const) blocked.addSubnet(addr, prefix, "ipv6");

/** Whether an address is private, loopback, link-local, reserved or otherwise not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1]!, "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true;
}

const allowPrivate = () => process.env["LOGO_URL_ALLOW_PRIVATE"] === "1" && process.env["NODE_ENV"] !== "production";

/** Parse and check a logo link; returns the URL or throws a message the admin can act on. */
export function checkLogoUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new RemoteImageError("Enter a full image link starting with https://"); }
  if (url.protocol !== "https:" && !(allowPrivate() && url.protocol === "http:")) throw new RemoteImageError("The image link must start with https://");
  if (url.username || url.password) throw new RemoteImageError("Image links can't contain a user name or password.");
  if (url.port && url.port !== "443" && !allowPrivate()) throw new RemoteImageError("Image links must use the standard https port.");
  if (raw.length > 2000) throw new RemoteImageError("That link is too long.");
  return url;
}

async function resolvePublic(host: string): Promise<{ address: string; family: number }> {
  const bare = host.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(bare) ? [{ address: bare, family: net.isIP(bare) }] : await lookup(bare, { all: true, verbatim: true }).catch(() => []);
  if (!addrs.length) throw new RemoteImageError("That site couldn't be found. Check the link.");
  if (!allowPrivate() && addrs.some(a => isPrivateAddress(a.address))) throw new RemoteImageError("That link points to a private or internal address, so it can't be used.");
  return addrs[0]!;
}

function getOnce(url: URL, pinned: { address: string; family: number }): Promise<{ status: number; location?: string; body?: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, {
      method: "GET",
      headers: { "User-Agent": "GrantApp-logo-fetch/1.0", Accept: "image/png,image/jpeg,image/webp,image/*;q=0.8" },
      // Connect to the address we checked, whatever DNS says now (TLS still verifies the certificate for url.hostname).
      lookup: (_host, opts, cb) => {
        if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pinned]);
        else cb(null, pinned.address, pinned.family);
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.resume(); resolve({ status, location: res.headers.location }); return; }
      if (status !== 200) { res.resume(); resolve({ status }); return; }
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > MAX_LOGO_BYTES) { res.destroy(); reject(new RemoteImageError("That image is larger than 2 MB.")); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_LOGO_BYTES) { res.destroy(); reject(new RemoteImageError("That image is larger than 2 MB.")); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new RemoteImageError("The site took too long to send the image.")));
    req.on("error", (err) => reject(err instanceof RemoteImageError ? err : new RemoteImageError("The image couldn't be downloaded from that link.")));
    req.end();
  });
}

/** Download the image at `raw`; returns its bytes and a display name. Throws RemoteImageError with a message for the admin. */
export async function fetchRemoteImage(raw: string): Promise<{ buffer: Buffer; name: string }> {
  let url = checkLogoUrl(raw);
  const deadline = Date.now() + TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (Date.now() > deadline) throw new RemoteImageError("The site took too long to send the image.");
    const pinned = await resolvePublic(url.hostname);
    const res = await getOnce(url, pinned);
    if (res.location) {
      if (hop === MAX_REDIRECTS) throw new RemoteImageError("That link redirects too many times.");
      url = checkLogoUrl(new URL(res.location, url).toString());
      continue;
    }
    if (!res.body) throw new RemoteImageError(`The site answered ${res.status} instead of sending the image.`);
    if (!res.body.length) throw new RemoteImageError("The link returned an empty file.");
    const name = decodeURIComponent(url.pathname.split("/").pop() || "logo").slice(0, 80) || "logo";
    return { buffer: res.body, name };
  }
  throw new RemoteImageError("That link redirects too many times.");
}
