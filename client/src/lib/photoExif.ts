// ─────────────────────────────────────────────────────────────────────────────
// Client-side EXIF extraction from an uploaded image File.
//
// Uses exifr (small, fast library) to pull GPS, original capture timestamp,
// and camera identity out of the file BEFORE we base64-encode & upload it.
// The server never has to parse EXIF itself; we just persist what the client
// found. Empty fields are fine — legacy uploads and screenshots simply don't
// have GPS/EXIF, and that's expected.
//
// Also produces a downscaled JPEG when the source is huge (>1600px on the
// long edge) so the payload stays reasonable. EXIF metadata is captured
// BEFORE downscaling, so evidence quality is preserved in the record even
// though the pixels themselves are compressed.
// ─────────────────────────────────────────────────────────────────────────────
import exifr from "exifr";

export interface ExtractedExif {
  latitude?: string;      // decimal degrees, stringified so we can persist NULL vs "0"
  longitude?: string;
  originalTakenAt?: string; // ISO8601 from camera DateTimeOriginal
  deviceMake?: string;
  deviceModel?: string;
}

export async function extractExif(file: File): Promise<ExtractedExif> {
  try {
    const parsed = await exifr.parse(file, {
      // Only pull the tags we actually persist. Keeps parse fast + memory low.
      pick: ["latitude", "longitude", "GPSLatitude", "GPSLongitude", "DateTimeOriginal", "CreateDate", "Make", "Model"],
      gps: true,
    });
    if (!parsed) return {};
    const out: ExtractedExif = {};
    if (typeof parsed.latitude === "number") out.latitude = parsed.latitude.toFixed(6);
    if (typeof parsed.longitude === "number") out.longitude = parsed.longitude.toFixed(6);
    const dto = parsed.DateTimeOriginal || parsed.CreateDate;
    if (dto instanceof Date && !isNaN(dto.getTime())) out.originalTakenAt = dto.toISOString();
    if (parsed.Make) out.deviceMake = String(parsed.Make).trim().slice(0, 60);
    if (parsed.Model) out.deviceModel = String(parsed.Model).trim().slice(0, 60);
    return out;
  } catch (e) {
    // Failing EXIF parse must never block upload — screenshots, edited images,
    // and older Android files sometimes throw.
    console.warn("[photoExif] parse failed:", (e as any)?.message || e);
    return {};
  }
}

// Downscale a File to a base64 JPEG under `maxDim` pixels on the long edge.
// Used to keep upload payloads small on huge camera images without losing
// perceived quality. Also normalizes to JPEG so the PDF renderer path is
// consistent regardless of source format (HEIC → JPEG happens implicitly via
// canvas).
export async function fileToDataUrl(file: File, maxDim = 1800, quality = 0.85): Promise<string> {
  const buffer = await file.arrayBuffer();
  const blob = new Blob([buffer], { type: file.type || "image/jpeg" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2d context unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
