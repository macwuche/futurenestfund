import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { db, demoMailFilesTable, type DemoMailFile } from "@workspace/db";
import { UPLOAD_DIR, UploadError } from "./uploads";
import { VirusFoundError, scanBuffer, scanTarget } from "./virusScan";
import { checkAttachment, cleanFileName, MAX_ATTACHMENT_BYTES } from "./mailRules";
import { logger } from "./logger";

/**
 * Mail attachments and signature logos on the upload disk, in `<UPLOAD_DIR>/mail/` (backed up with the other uploads).
 * Every file is virus-scanned when ClamAV is on, then checked against the accepted types (mailRules.checkAttachment).
 * A received attachment that isn't accepted is recorded without its bytes (`blockedReason`), so the reader can say what
 * was held back.
 */
export const MAIL_DIR = path.join(UPLOAD_DIR, "mail");
await mkdir(MAIL_DIR, { recursive: true, mode: 0o700 });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function scan(buf: Buffer, what: string): Promise<string | null> {
  try {
    const result = await scanBuffer(buf);
    if (result === "skipped" && scanTarget()) logger.warn({ what }, "Virus scanner unavailable; mail file accepted unscanned (CLAMAV_FAIL_OPEN=1)");
    return null;
  } catch (e) {
    if (e instanceof VirusFoundError) {
      logger.warn({ what, signature: e.signature }, "Mail file refused: virus scanner flagged it");
      return "This file didn't pass the virus scan.";
    }
    throw e;
  }
}

async function write(buf: Buffer, ext: string): Promise<string> {
  const storedName = `${randomUUID()}.${ext}`;
  await writeFile(path.join(MAIL_DIR, storedName), buf, { flag: "wx", mode: 0o600 });
  return storedName;
}

/** An attachment the admin uploads in Compose: refused with a message when it isn't accepted. */
export async function storeComposeAttachment(file: Express.Multer.File | undefined, actor: string): Promise<DemoMailFile> {
  if (!file || file.size === 0) throw new UploadError("Choose a file to attach.");
  const virus = await scan(file.buffer, "compose attachment");
  if (virus) throw new UploadError(`${virus} Scan your device, or attach a different copy.`);
  const name = Buffer.from(file.originalname, "latin1").toString("utf8");
  const v = checkAttachment(file.buffer, name, MAX_ATTACHMENT_BYTES);
  if (!v.ok) throw new UploadError(v.reason);
  const storedName = await write(file.buffer, v.ext);
  try {
    const [row] = await db.insert(demoMailFilesTable).values({
      purpose: "attachment", originalName: v.name, mimeType: v.type, sizeBytes: file.buffer.length,
      sha256: createHash("sha256").update(file.buffer).digest("hex"), storedName, uploadedBy: actor,
    }).returning();
    return row!;
  } catch (err) {
    await unlink(path.join(MAIL_DIR, storedName)).catch(() => {});
    throw err;
  }
}

/** A received attachment: kept when accepted, otherwise recorded with the reason (never throws for a bad file). */
export async function storeReceivedAttachment(tx: Tx, messageId: string, a: { filename: string; contentType: string; contentId: string | null; inline: boolean; size: number },
  bytes: Buffer | "too-large" | null, maxBytes: number): Promise<DemoMailFile> {
  const base = { purpose: "attachment", messageId, contentId: a.contentId, inline: a.inline, uploadedBy: null } as const;
  const blocked = (reason: string) => tx.insert(demoMailFilesTable).values({ ...base, originalName: cleanFileName(a.filename), mimeType: a.contentType.slice(0, 100), sizeBytes: a.size || 0, blockedReason: reason }).returning().then((r) => r[0]!);
  if (bytes === null) return blocked("The attachment couldn't be downloaded from Resend.");
  if (bytes === "too-large") return blocked(`Larger than ${Math.round(maxBytes / 1024 / 1024)} MB, so it wasn't kept.`);
  const virus = await scan(bytes, "received attachment");
  if (virus) return blocked(virus);
  const v = checkAttachment(bytes, a.filename, maxBytes);
  if (!v.ok) return blocked(v.reason);
  const storedName = await write(bytes, v.ext);
  try {
    const [row] = await tx.insert(demoMailFilesTable).values({ ...base, originalName: v.name, mimeType: v.type, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), storedName }).returning();
    return row!;
  } catch (err) {
    await unlink(path.join(MAIL_DIR, storedName)).catch(() => {});
    throw err;
  }
}

/** A signature logo: an image, re-encoded to PNG at most 400 × 160 px (shown at 48 px high, sharp on high-density screens). */
export async function storeSignatureLogo(file: Express.Multer.File | undefined, actor: string): Promise<DemoMailFile> {
  if (!file || file.size === 0) throw new UploadError("Choose an image for the logo.");
  if (file.size > 5 * 1024 * 1024) throw new UploadError("The logo can be up to 5 MB.");
  const virus = await scan(file.buffer, "signature logo");
  if (virus) throw new UploadError(virus);
  const v = checkAttachment(file.buffer, file.originalname);
  if (!v.ok || !/^image\/(jpeg|png|webp|gif)$/.test(v.type)) throw new UploadError("Upload the logo as a JPG, PNG, WebP or GIF image.");
  let data: Buffer;
  try {
    data = await sharp(file.buffer, { limitInputPixels: 50_000_000, failOn: "error" }).rotate().resize(400, 160, { fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  } catch {
    throw new UploadError("This image couldn't be read. Try a different PNG or JPG.");
  }
  const storedName = await write(data, "png");
  const [row] = await db.insert(demoMailFilesTable).values({ purpose: "logo", originalName: "signature-logo.png", mimeType: "image/png", sizeBytes: data.length, storedName, uploadedBy: actor }).returning();
  return row!;
}

export async function readMailFile(row: DemoMailFile): Promise<Buffer> {
  if (!row.storedName) throw new UploadError(`${row.originalName} wasn't kept, so it can't be sent.`);
  return readFile(path.join(MAIL_DIR, row.storedName));
}

/** Copies a stored file for another message (forwarding keeps the original untouched). */
export async function copyMailFile(tx: Tx, row: DemoMailFile, messageId: string, actor: string): Promise<DemoMailFile | null> {
  if (!row.storedName) return null;
  const storedName = `${randomUUID()}${path.extname(row.storedName)}`;
  await copyFile(path.join(MAIL_DIR, row.storedName), path.join(MAIL_DIR, storedName));
  const [copy] = await tx.insert(demoMailFilesTable).values({
    purpose: "attachment", messageId, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, sha256: row.sha256, storedName, uploadedBy: actor,
  }).returning();
  return copy!;
}

export async function findMailFile(id: string): Promise<DemoMailFile | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await db.select().from(demoMailFilesTable).where(eq(demoMailFilesTable.id, id));
  return row;
}

/** Streams a file with headers that stop browsers from running or sniffing it on our origin. */
export async function sendMailFile(req: Request, res: Response, row: DemoMailFile | undefined, opts: { publicLogo?: boolean } = {}) {
  if (!row?.storedName) { res.status(404).json({ error: "File not found." }); return; }
  const full = path.join(MAIL_DIR, row.storedName);
  try { await stat(full); } catch { res.status(404).json({ error: "This file is no longer on the server." }); return; }
  const inline = /^image\/(jpeg|png|gif|webp)$/.test(row.mimeType) && req.query["download"] === undefined;
  res.setHeader("Content-Type", row.mimeType);
  res.setHeader("Content-Length", String(row.sizeBytes));
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.originalName)}`);
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  if (opts.publicLogo) {
    // Recipients' mail apps load the signature logo from anywhere.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
  } else res.setHeader("Cache-Control", "private, max-age=86400, immutable");
  createReadStream(full).on("error", (err) => { req.log.error({ err }, "Mail file stream failed"); res.destroy(err); }).pipe(res);
}

/** Deletes rows and then bytes (a crash leaves at worst an unreferenced file). */
export async function removeMailFiles(ids: string[]) {
  if (!ids.length) return;
  const rows = await db.delete(demoMailFilesTable).where(inArray(demoMailFilesTable.id, ids)).returning();
  for (const r of rows) if (r.storedName) await unlink(path.join(MAIL_DIR, r.storedName)).catch((err) => logger.warn({ err, id: r.id }, "Could not delete mail file bytes"));
}
