import crypto from "crypto";

// AES-256-GCM encryption for sensitive fields at rest
// Key is derived from a server-side secret — never stored with the data.
// In production, TITAN_ENCRYPT_KEY MUST be set. Falling back to a hardcoded key
// in production would mean sensitive fields are effectively unencrypted (the key
// is public in source), so we refuse to start instead. Locally (dev) we allow the
// default so the app runs without setup.
const DEFAULT_DEV_KEY = "titan_pro_field_encryption_key_2026_aes256";
if (process.env.NODE_ENV === "production" && !process.env.TITAN_ENCRYPT_KEY) {
  throw new Error(
    "[encryption] TITAN_ENCRYPT_KEY is not set. Set it in your production environment " +
    "(e.g. Railway Variables) to a long random secret before starting the server. " +
    "Refusing to start with the insecure default key."
  );
}
const ENCRYPTION_KEY_SOURCE = process.env.TITAN_ENCRYPT_KEY || DEFAULT_DEV_KEY;

function deriveKey(): Buffer {
  return crypto.createHash("sha256").update(ENCRYPTION_KEY_SOURCE).digest();
}

export function encryptField(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  try {
    const key = deriveKey();
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Store as: iv(hex):authTag(hex):ciphertext(hex)
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
  } catch {
    return plaintext; // fallback: store plaintext if encryption fails
  }
}

export function decryptField(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!ciphertext.includes(":")) return ciphertext; // legacy plaintext — return as-is
  try {
    const key = deriveKey();
    const parts = ciphertext.split(":");
    if (parts.length < 3) return ciphertext; // not encrypted format
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encrypted = Buffer.from(parts.slice(2).join(":"), "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final("utf8");
  } catch {
    return ciphertext; // return raw if decryption fails (key mismatch or legacy data)
  }
}

export function maskField(value: string | null | undefined, showLast = 4): string {
  if (!value) return "";
  const v = value.toString();
  if (v.length <= showLast) return "•".repeat(v.length);
  return "•".repeat(v.length - showLast) + v.slice(-showLast);
}

export function maskPayoutHandle(handle: string | null | undefined, method: string): string {
  if (!handle) return "";
  try {
    // handle may be JSON for direct_deposit
    if (method === "direct_deposit") {
      const obj = JSON.parse(handle);
      return {
        bankName: obj.bankName || "",
        routingLast4: obj.routing ? maskField(obj.routing) : "••••",
        accountLast4: obj.account ? maskField(obj.account) : "••••",
      } as any;
    }
  } catch {}
  // For cashapp/venmo/zelle — mask middle, show last 4
  return maskField(handle, 4);
}
