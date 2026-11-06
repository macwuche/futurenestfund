/**
 * Branding (Admin Settings → Branding): the application's name, its brand colour and an optional logo, shown on both the
 * applicant and admin sides, the sign-in pages and every email. Stored in `demo_settings.branding`; public (the sign-in
 * pages need it before anyone signs in). Open screens re-read it every 15 seconds.
 */
import { eq } from "drizzle-orm";
import { db, demoAuditTable, demoSettingsTable } from "@workspace/db";
import { brandPalette, DEFAULT_BRAND_COLOR, normalizeHex } from "./brandColors";
import { DemoInputError } from "./demoWorkspace";
import { setAppBrand } from "./emailTemplates";
import { logger } from "./logger";
import { fetchRemoteImage, MAX_LOGO_BYTES, RemoteImageError } from "./remoteImage";
import { findFile, removeFile, storeUpload, UploadError } from "./uploads";

export const DEFAULT_APP_NAME = "GrantApp";
const LOGO_OWNER = "platform";
const NAME_LIMITS = [2, 40] as const;

type Stored = { appName: string; color: string; logoFileId: string | null; logoSource: string | null };

function readStored(raw: unknown): Stored {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = typeof r["appName"] === "string" ? cleanName(r["appName"]) : "";
  return {
    appName: name.length >= NAME_LIMITS[0] ? name : DEFAULT_APP_NAME,
    color: normalizeHex(r["color"]) ?? DEFAULT_BRAND_COLOR,
    logoFileId: typeof r["logoFileId"] === "string" ? r["logoFileId"] : null,
    logoSource: typeof r["logoSource"] === "string" ? r["logoSource"] : null,
  };
}
const cleanName = (v: string) => v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();

// A short cache: every open screen asks every 15 seconds.
let cache: { at: number; value: Stored } | null = null;
async function load(): Promise<Stored> {
  if (cache && Date.now() - cache.at < 5_000) return cache.value;
  const [s] = await db.select({ branding: demoSettingsTable.branding }).from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform"));
  const value = readStored(s?.branding);
  cache = { at: Date.now(), value };
  setAppBrand({ name: value.appName, color: value.color });
  return value;
}
const forget = () => { cache = null; };

/** What every screen gets (signed in or not). `version` changes with every save, so caches can tell. */
export async function publicBranding() {
  const b = await load();
  return {
    appName: b.appName, color: b.color, palette: brandPalette(b.color),
    logoUrl: b.logoFileId ? `/api/branding/logo?v=${b.logoFileId.slice(0, 8)}` : null,
  };
}
export async function adminBranding() {
  const b = await load();
  return { ...(await publicBranding()), logoSource: b.logoSource, defaults: { appName: DEFAULT_APP_NAME, color: DEFAULT_BRAND_COLOR } };
}

async function save(actor: string, change: (b: Stored) => Stored, describe: (before: Stored, after: Stored) => string | null) {
  await db.transaction(async tx => {
    const [row] = await tx.select({ branding: demoSettingsTable.branding }).from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    const before = readStored(row?.branding);
    const after = change(before);
    const what = describe(before, after);
    if (!what) return;
    await tx.update(demoSettingsTable).set({ branding: after }).where(eq(demoSettingsTable.id, "platform"));
    await tx.insert(demoAuditTable).values({ actor, action: `Branding: ${what}` });
  });
  forget();
  return adminBranding();
}

export async function changeBranding(input: { appName?: unknown; color?: unknown }, actor: string) {
  const name = typeof input.appName === "string" ? cleanName(input.appName) : "";
  if (name.length < NAME_LIMITS[0] || name.length > NAME_LIMITS[1]) throw new DemoInputError(`Give the application a name of ${NAME_LIMITS[0]}–${NAME_LIMITS[1]} characters.`);
  const color = normalizeHex(input.color);
  if (!color) throw new DemoInputError("Choose a colour, or enter it as a hex code like #16A34A.");
  return save(actor, b => ({ ...b, appName: name, color }), (b, a) => {
    const parts = [
      ...(b.appName !== a.appName ? [`name "${b.appName}" → "${a.appName}"`] : []),
      ...(b.color !== a.color ? [`colour ${b.color} → ${a.color}`] : []),
    ];
    return parts.length ? parts.join(", ") : null;
  });
}

async function storeLogo(file: Express.Multer.File, actor: string, source: string) {
  let previous: string | null = null;
  await storeUpload(LOGO_OWNER, "logo", file, async (stored, tx) => {
    const [row] = await tx.select({ branding: demoSettingsTable.branding }).from(demoSettingsTable).where(eq(demoSettingsTable.id, "platform")).for("update");
    const b = readStored(row?.branding);
    previous = b.logoFileId;
    await tx.update(demoSettingsTable).set({ branding: { ...b, logoFileId: stored.id, logoSource: source } }).where(eq(demoSettingsTable.id, "platform"));
    await tx.insert(demoAuditTable).values({ actor, action: `Branding: logo ${source === "upload" ? "uploaded" : `taken from ${source}`}` });
  });
  forget();
  if (previous) await removeFile(previous).catch(err => logger.warn({ err }, "Old brand logo not removed"));
  return adminBranding();
}

/** An uploaded logo (PNG, JPEG or WebP, up to 2 MB; re-encoded to WebP, EXIF removed). */
export async function setBrandLogo(file: Express.Multer.File | undefined, actor: string) {
  if (!file) throw new UploadError("Choose a logo image to upload.");
  if (file.size > MAX_LOGO_BYTES) throw new UploadError("Logos must be 2 MB or smaller.");
  return storeLogo(file, actor, "upload");
}

/** A logo from an https:// link: downloaded once and stored (never hot-linked; private addresses refused). */
export async function setBrandLogoFromUrl(url: string, actor: string) {
  let image: { buffer: Buffer; name: string };
  try { image = await fetchRemoteImage(url); } catch (err) {
    if (err instanceof RemoteImageError) throw new DemoInputError(err.message);
    throw err;
  }
  const file = { buffer: image.buffer, size: image.buffer.length, originalname: image.name } as Express.Multer.File;
  return storeLogo(file, actor, new URL(url).hostname);
}

export async function clearBrandLogo(actor: string) {
  let previous: string | null = null;
  const result = await save(actor, b => { previous = b.logoFileId; return { ...b, logoFileId: null, logoSource: null }; }, b => (b.logoFileId ? "logo removed" : null));
  if (previous) await removeFile(previous).catch(err => logger.warn({ err }, "Old brand logo not removed"));
  return result;
}

export async function brandLogoFile() {
  const b = await load();
  return b.logoFileId ? findFile(b.logoFileId, LOGO_OWNER) : undefined;
}

/** At start-up and every minute: other API processes pick up a change made elsewhere (emails use the name and colour). */
export async function loadBranding() { forget(); await load(); }
export function startBrandingRefresh(intervalMs = 60_000) {
  const tick = async () => {
    try { await loadBranding(); } catch (err) { logger.error({ err }, "Reloading branding failed"); }
    setTimeout(tick, intervalMs).unref();
  };
  setTimeout(tick, intervalMs).unref();
}
