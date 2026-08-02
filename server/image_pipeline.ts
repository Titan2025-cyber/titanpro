// Image-write / image-read pipeline.
//
// This is the single choke point every image or document upload flows through.
// It hides the "is object storage configured?" branch from every route so
// server/routes.ts stays readable and adding a new image field never requires
// touching the S3 SDK directly.
//
// Two entry points:
//   `writeImageField(dataUrl, scope)`     — accepts a `data:` URL from the
//                                            client, uploads to S3 if
//                                            configured, returns {dataUrl,
//                                            storageKey} to persist.
//   `readImageField({dataUrl, storageKey})` — returns a URL the frontend can
//                                            render as an <img src>; either a
//                                            signed S3 URL or the original
//                                            base64.

import * as s3 from "./storage_s3";

export interface StoredImage {
  /**
   * Value to persist in the DB's data_url column. Empty string when the file
   * lives in S3 — the frontend will materialize a URL from `storageKey` on
   * read. Base64 data URL when S3 isn't configured (dev fallback).
   */
  dataUrl: string;
  /**
   * Object key in the bucket, or empty string when we couldn't upload (either
   * the input wasn't a data URL, or S3 isn't configured).
   */
  storageKey: string;
}

/**
 * Persist an incoming image blob.
 *
 * Behavior:
 *   • Input is a `data:` URL and S3 is configured → upload, return storage key.
 *   • Input is a `data:` URL but S3 is not configured → store base64 inline.
 *   • Input is already an http/https URL → don't touch it; keep it as-is.
 *   • Input is empty or malformed → return empty pair.
 *
 * `scope` becomes the top-level prefix in the bucket ("photos", "documents",
 * "checklists"…). Lifecycle rules and access policies can key off this.
 */
export async function writeImageField(
  dataUrl: string | null | undefined,
  scope: string,
): Promise<StoredImage> {
  if (!dataUrl || typeof dataUrl !== "string") {
    return { dataUrl: "", storageKey: "" };
  }
  // Already a URL — leave it alone (external references, previously-stored keys).
  if (/^https?:\/\//i.test(dataUrl)) {
    return { dataUrl, storageKey: "" };
  }
  if (!dataUrl.startsWith("data:")) {
    // Whatever this is, we can't upload it; pass through.
    return { dataUrl, storageKey: "" };
  }
  if (!s3.isConfigured()) {
    // Dev fallback: keep the base64 in-line so the app still works.
    return { dataUrl, storageKey: "" };
  }
  const parsed = s3.parseDataUrl(dataUrl);
  if (!parsed) {
    // Malformed data URL — pass through so we don't lose the client's data.
    return { dataUrl, storageKey: "" };
  }
  const key = s3.makeKey(scope, parsed.extension);
  await s3.putObject(key, parsed.buffer, parsed.contentType);
  return { dataUrl: "", storageKey: key };
}

/**
 * Same as `writeImageField` but returns `null` on upload failure instead of
 * throwing. Prefer this in routes that already have many other steps — a
 * transient S3 error shouldn't take down the whole request.
 */
export async function writeImageFieldSafe(
  dataUrl: string | null | undefined,
  scope: string,
): Promise<StoredImage> {
  try {
    return await writeImageField(dataUrl, scope);
  } catch (e) {
    console.error("[image_pipeline] write failed:", (e as any)?.message || e);
    // Fall back to storing inline so the user's upload isn't lost.
    return { dataUrl: dataUrl || "", storageKey: "" };
  }
}

/**
 * Resolve a row's image field to a URL the frontend can render.
 *
 * If the row has a storage key, we generate a short-lived signed URL. If it
 * doesn't (legacy row, or S3 not configured), we return whatever data URL is
 * in the row.
 */
export async function readImageField(
  row: { data_url?: string | null; dataUrl?: string | null; storage_key?: string | null; storageKey?: string | null } | null | undefined,
): Promise<string> {
  if (!row) return "";
  const key = row.storage_key || row.storageKey || "";
  if (key && s3.isConfigured()) {
    try {
      return await s3.getReadUrl(key);
    } catch (e) {
      console.error("[image_pipeline] sign failed for key", key, ":", (e as any)?.message || e);
      // Fall through to whatever inline data we may still have.
    }
  }
  return (row.data_url || row.dataUrl || "") as string;
}

/**
 * Bulk variant. Rewrites each row in place so `data_url` becomes the
 * viewable URL. Returns the same array reference for chaining.
 *
 * Uses Promise.all so the signed-URL round-trip fanned across many rows
 * doesn't serialize into a slow render.
 */
export async function hydrateImageRows(
  rows: any[],
  fields: { urlField?: string; keyField?: string } = {},
): Promise<any[]> {
  const urlField = fields.urlField || "data_url";
  const keyField = fields.keyField || "storage_key";
  await Promise.all(
    rows.map(async (r: any) => {
      const key = r[keyField] || "";
      if (key && s3.isConfigured()) {
        try {
          r[urlField] = await s3.getReadUrl(key);
        } catch {
          // Leave whatever's already in urlField.
        }
      }
    })
  );
  return rows;
}
