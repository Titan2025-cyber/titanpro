// Railway Object Storage (S3-compatible) wrapper.
//
// Configured entirely from environment variables so the same binary works
// against local disk (dev), Railway prod, and any other S3-compatible target.
// If any of the required env vars are missing, `isConfigured()` returns false
// and callers fall back to storing images inline as base64 data URLs.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";

// Recognize three env-var naming conventions so we don't force the operator to
// rename bucket variables on their hosting provider:
//   1. S3_* — our preferred, provider-agnostic names
//   2. STORAGE_* — alternate prefix some deploys use
//   3. AWS_* — Railway/AWS-CLI defaults, so `AWS_ENDPOINT_URL`,
//      `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
//      and `AWS_DEFAULT_REGION` work with no code change.
const S3_ENDPOINT =
  process.env.S3_ENDPOINT ||
  process.env.STORAGE_ENDPOINT ||
  process.env.AWS_ENDPOINT_URL ||
  "";
const S3_REGION =
  process.env.S3_REGION ||
  process.env.STORAGE_REGION ||
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  "us-east-1";
const S3_BUCKET =
  process.env.S3_BUCKET ||
  process.env.STORAGE_BUCKET ||
  process.env.AWS_S3_BUCKET_NAME ||
  process.env.AWS_S3_BUCKET ||
  process.env.AWS_BUCKET ||
  "";
const S3_ACCESS_KEY =
  process.env.S3_ACCESS_KEY_ID ||
  process.env.STORAGE_ACCESS_KEY_ID ||
  process.env.AWS_ACCESS_KEY_ID ||
  "";
const S3_SECRET_KEY =
  process.env.S3_SECRET_ACCESS_KEY ||
  process.env.STORAGE_SECRET_ACCESS_KEY ||
  process.env.AWS_SECRET_ACCESS_KEY ||
  "";

// Signed URL lifetime. 1 hour is plenty for a page render and short enough
// that a leaked URL becomes useless quickly.
const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;

let _client: S3Client | null = null;

export function isConfigured(): boolean {
  return Boolean(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);
}

export function getClient(): S3Client {
  if (_client) return _client;
  if (!isConfigured()) {
    throw new Error("Object storage is not configured (missing S3_ENDPOINT/S3_BUCKET/keys)");
  }
  _client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    // path-style is required for most non-AWS S3-compatible providers
    // (Railway, R2, MinIO). AWS itself also accepts path-style.
    forcePathStyle: true,
    credentials: {
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
    },
  });
  return _client;
}

/**
 * Choose an object key for a new upload.
 *
 * Keys are hierarchical so lifecycle rules and access controls can be applied
 * per category. Random suffix prevents overwrites and enum leaks. Extension is
 * preserved so browsers pick the correct viewer.
 */
export function makeKey(scope: string, extension: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const rand = crypto.randomBytes(8).toString("hex");
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return `${scope}/${year}/${month}/${rand}${ext}`;
}

/**
 * Upload a buffer to the bucket. Returns the object key on success.
 *
 * The caller is responsible for storing this key in whatever DB row references
 * the image, so `getReadUrl(key)` can regenerate a signed URL on demand.
 */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    // Cache aggressively; keys are content-addressed by random suffix so
    // updates always produce a new key.
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return key;
}

/**
 * Get a time-limited signed URL for reading an object.
 *
 * Bucket is private; only this URL grants access, and only until it expires.
 */
export async function getReadUrl(
  key: string,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
  opts?: { responseContentType?: string; responseContentDisposition?: string },
): Promise<string> {
  const client = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      // Force S3 to return these headers on the response. Without this an
      // uploaded PDF can come back as application/octet-stream and render
      // as a blank black tab in Chrome/Safari. We pass the caller's known
      // MIME through, and default the disposition to 'inline' so PDFs open
      // in the browser's viewer instead of triggering a download.
      ResponseContentType: opts?.responseContentType,
      ResponseContentDisposition: opts?.responseContentDisposition,
    }),
    { expiresIn: ttlSeconds },
  );
}

export async function deleteObject(key: string): Promise<void> {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

export async function objectExists(key: string): Promise<boolean> {
  const client = getClient();
  try {
    await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a data URL into a raw buffer plus its content type.
 *
 * Used by the boot-time migration that lifts inline base64 photos into the
 * bucket. Returns null for anything that doesn't look like a data URL so the
 * migration can skip the row cleanly.
 */
export function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string; extension: string } | null {
  // Tolerant of extra media-type parameters (jsPDF sneaks in
  // `;filename=generated.pdf` before `;base64,`). Without this jsPDF output
  // fails the parse and gets stored inline as a raw URI instead of uploaded
  // to S3 with the proper content-type.
  const m = /^data:([^;,]+)(?:;[^;,]+=[^;,]+)*;base64,(.*)$/is.exec(dataUrl);
  if (!m) return null;
  const contentType = m[1] || "application/octet-stream";
  const buffer = Buffer.from(m[2], "base64");
  const extFromMime = contentType.split("/")[1]?.split("+")[0] || "bin";
  // Normalize a couple of common cases.
  const extension =
    extFromMime === "jpeg" ? "jpg" :
    extFromMime === "svg+xml" ? "svg" :
    extFromMime;
  return { buffer, contentType, extension };
}

/**
 * Boot-time diagnostics so misconfiguration is loud in the logs but never
 * fatal (dev environments intentionally have no bucket).
 */
export function logStatus(): void {
  if (!isConfigured()) {
    console.log("[storage_s3] not configured; images will use inline data URLs");
    return;
  }
  console.log(
    `[storage_s3] ready endpoint=${S3_ENDPOINT} bucket=${S3_BUCKET} region=${S3_REGION}`
  );
}
