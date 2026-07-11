import crypto from "crypto";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import QRCode from "qrcode";

// TOTP defaults (SHA-1, 6 digits, 30s period) match what Google Authenticator and
// Microsoft Authenticator expect. `window: 1` tolerates ±30s of clock drift.
authenticator.options = { window: 1 };

const ISSUER = "Titan Pro";
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_ROUNDS = 10; // cheaper than passwords — backup codes are high entropy

export function generateSecret(): string {
  return authenticator.generateSecret(20); // 20 bytes → base32
}

export function buildOtpauthUrl(accountName: string, secret: string): string {
  return authenticator.keyuri(accountName, ISSUER, secret);
}

export async function buildQrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

export function verifyTotp(code: string, secret: string): boolean {
  if (!code || !secret) return false;
  try {
    return authenticator.verify({ token: code.replace(/\s/g, ""), secret });
  } catch {
    return false;
  }
}

// Format: xxxx-xxxx (8 hex chars split by a dash). Returns the plaintext codes;
// caller stores only the bcrypt hashes and shows the plaintext once.
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = crypto.randomBytes(4).toString("hex"); // 8 hex chars
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}`);
  }
  return codes;
}

export function hashBackupCodes(codes: string[]): string[] {
  return codes.map(c => bcrypt.hashSync(normalizeBackupCode(c), BACKUP_CODE_ROUNDS));
}

export function normalizeBackupCode(code: string): string {
  return (code || "").trim().toLowerCase().replace(/\s/g, "");
}

// Returns the index of the matching hash, or -1 if none match.
export function matchBackupCode(code: string, hashes: string[]): number {
  const normalized = normalizeBackupCode(code);
  if (!normalized) return -1;
  for (let i = 0; i < hashes.length; i++) {
    try {
      if (bcrypt.compareSync(normalized, hashes[i])) return i;
    } catch { /* skip malformed hash */ }
  }
  return -1;
}
