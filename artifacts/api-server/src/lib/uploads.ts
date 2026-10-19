import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Request, RequestHandler, Response } from "express";
import multer from "multer";
import sharp from "sharp";
import { and, count, eq } from "drizzle-orm";
import { db, demoFilesTable } from "@workspace/db";
import { logger } from "./logger";

/** Thrown for uploads the user can fix; the app's error handler turns it into a 400. */
export class UploadError extends Error {}

/** Files live on the API server's disk (per replit.md), outside the web root. */
export const UPLOAD_DIR = path.resolve(process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), "uploads"));
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_USER = 200;
const MAX_INPUT_PIXELS = 50_000_000; // guards against decompression bombs

export type Purpose = "avatar" | "kyc" | "proposal";
const IMAGE = ["image/jpeg", "image/png", "image/webp"] as const;
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPTS: Record<Purpose, { types: readonly string[]; label: string }> = {
  avatar: { types: IMAGE, label: "a JPG, PNG or WebP image" },
  kyc: { types: [...IMAGE, PDF], label: "a JPG, PNG or WebP image, or a PDF" },
  proposal: { types: [PDF, DOCX], label: "a PDF or Word (.docx) document" },
};

await mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });

/** Single-file multipart parser held in memory (10 MB cap) so nothing unvalidated touches the disk. */
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 4, fieldSize: 200, parts: 5 },
}).single("file");

export const receiveFile: RequestHandler = (req, res, next) => {
  parser(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "Files must be 10 MB or smaller."
        : err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT" ? "Send one file in a field named \"file\"."
        : "The upload could not be read.";
      return next(new UploadError(msg));
    }
    next(err);
  });
};

/** Identify the real file type from its first bytes; the browser-supplied type is ignored. */
function sniff(buf: Buffer): string | undefined {
  if (buf.length < 12) return undefined;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("latin1", 0, 5) === "%PDF-") return PDF;
  if (buf.readUInt32LE(0) === 0x04034b50 && buf.includes("word/document.xml")) return DOCX;
  return undefined;
}

/** Structural checks for documents we store as-is (they are never re-rendered on our origin). */
function checkDocument(buf: Buffer, type: string) {
  if (type === PDF) {
    if (!buf.subarray(-1024).includes("%%EOF")) throw new UploadError("This PDF looks incomplete or damaged.");
    // Active content has no place in a grant document; refuse rather than try to sanitize.
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/.test(buf.toString("latin1"))) {
      throw new UploadError("PDFs with scripts, attachments or embedded media can't be accepted. Please export a plain PDF.");
    }
  }
  if (type === DOCX && buf.includes("vbaProject.bin")) throw new UploadError("Word files with macros can't be accepted. Please save as a plain .docx.");
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", [PDF]: "pdf", [DOCX]: "docx" };

/** Display-only file name: no path parts or control characters, sensible length and extension. */
function cleanName(raw: string, ext: string) {
  // multer decodes the multipart filename as latin1; recover UTF-8 names.
  const utf8 = Buffer.from(raw, "latin1").toString("utf8");
  const base = path.basename(utf8.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f"<>|]/g, "").replace(/\.[^.]*$/, "").trim().slice(0, 100);
  return `${base || "document"}.${ext}`;
}

/** Re-encode images: drops metadata (EXIF/GPS), applies orientation and caps dimensions. */
async function reencode(buf: Buffer, purpose: Purpose) {
  try {
    const img = sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate();
    if (purpose === "avatar") return { data: await img.resize(256, 256, { fit: "cover" }).webp({ quality: 82 }).toBuffer(), type: "image/webp" };
    return { data: await img.resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer(), type: "image/jpeg" };
  } catch (err) {
    logger.info({ err }, "Image rejected");
    throw new UploadError("This image couldn't be read. Try a different JPG or PNG.");
  }
}

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type StoredFile = typeof demoFilesTable.$inferSelect;

/**
 * Validate, normalize and write an uploaded file, then record it. The `record` callback runs in the same
 * transaction as the metadata insert, so a failed DB write never leaves an orphan on disk.
 */
export async function storeUpload<T>(
  profileId: string, purpose: Purpose, file: Express.Multer.File | undefined,
  record: (stored: StoredFile, tx: DbTx) => Promise<T>, applicationId?: string,
): Promise<T> {
  if (!file || file.size === 0) throw new UploadError("Choose a file to upload.");
  const detected = sniff(file.buffer);
  const accept = ACCEPTS[purpose];
  if (!detected || !accept.types.includes(detected)) throw new UploadError(`Upload ${accept.label}, up to 10 MB.`);
  const [{ n }] = await db.select({ n: count() }).from(demoFilesTable).where(eq(demoFilesTable.profileId, profileId));
  if (n >= MAX_FILES_PER_USER) throw new UploadError("You've reached the upload limit for this demo account.");

  let data = file.buffer; let type = detected;
  if ((IMAGE as readonly string[]).includes(detected)) ({ data, type } = await reencode(file.buffer, purpose));
  else checkDocument(file.buffer, detected);

  const storedName = `${randomUUID()}.${EXT[type]}`;
  const full = path.join(UPLOAD_DIR, storedName);
  await writeFile(full, data, { flag: "wx", mode: 0o600 });
  try {
    return await db.transaction(async (tx) => {
      const [stored] = await tx.insert(demoFilesTable).values({
        profileId, purpose, applicationId: applicationId ?? null, originalName: cleanName(file.originalname, EXT[type]!),
        mimeType: type, sizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), storedName,
      }).returning();
      return record(stored!, tx);
    });
  } catch (err) {
    await unlink(full).catch(() => {});
    throw err;
  }
}

/** Delete a file's row and bytes (bytes after the row, so a crash leaves at worst an unreferenced file). */
export async function removeFile(fileId: string) {
  const [row] = await db.delete(demoFilesTable).where(eq(demoFilesTable.id, fileId)).returning();
  if (row) await unlink(path.join(UPLOAD_DIR, row.storedName)).catch((err) => logger.warn({ err, fileId }, "Could not delete file bytes"));
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function findFile(fileId: string, profileId?: string) {
  if (!isUuid(fileId)) return undefined;
  const [row] = await db.select().from(demoFilesTable)
    .where(profileId ? and(eq(demoFilesTable.id, fileId), eq(demoFilesTable.profileId, profileId)) : eq(demoFilesTable.id, fileId));
  return row;
}

/** Stream a stored file with headers that stop browsers from running or sniffing it on our origin. */
export async function sendFile(req: Request, res: Response, row: StoredFile | undefined) {
  if (!row) { res.status(404).json({ error: "File not found." }); return; }
  const full = path.join(UPLOAD_DIR, row.storedName);
  try { await stat(full); } catch { res.status(404).json({ error: "This file is no longer available on the server." }); return; }
  const inline = row.mimeType.startsWith("image/") && req.query["download"] === undefined;
  res.setHeader("Content-Type", row.mimeType);
  res.setHeader("Content-Length", String(row.sizeBytes));
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.originalName)}`);
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  // Stored files never change (replacements get a new id), so private caching is safe.
  res.setHeader("Cache-Control", "private, max-age=86400, immutable");
  createReadStream(full).on("error", (err) => { req.log.error({ err }, "File stream failed"); res.destroy(err); }).pipe(res);
}

export const fileUrl = (scope: "applicant" | "admin", id: string) => `/api/${scope}/files/${id}`;
