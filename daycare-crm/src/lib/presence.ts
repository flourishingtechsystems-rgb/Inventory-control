// Self check-in secrets: kiosk PINs, the rotating "you are at the center" code
// for phone check-in, and the short-lived kiosk session token.

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

const CODE_WINDOW_MS = 15 * 60_000;
const KIOSK_TOKEN_TTL_MS = 2 * 60_000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET must be set.");
  return s;
}

function hmac(purpose: string, value: string) {
  return createHmac("sha256", secret()).update(`${purpose}:${value}`).digest("hex");
}

function safeEqual(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const PIN_LENGTH = 6;

export function isValidPin(pin: string) {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin) && !/^(\d)\1+$/.test(pin) && pin !== "123456" && pin !== "654321";
}

/**
 * Deterministic keyed digest so a PIN can be looked up (and kept unique)
 * without storing it. Brute force is limited by the kiosk lockout.
 */
export function pinDigest(pin: string) {
  return hmac("kiosk-pin", pin);
}

export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
    if (isValidPin(pin)) return pin;
  }
}

/** 6-digit code shown at the front desk; changes every 15 minutes. */
export function centerCode(at: Date = new Date()): string {
  const window = Math.floor(at.getTime() / CODE_WINDOW_MS);
  return String(parseInt(hmac("center-code", String(window)).slice(0, 8), 16) % 1_000_000).padStart(6, "0");
}

/** Accepts the current code or the one just before it (grace for a code that rotated mid-typing). */
export function verifyCenterCode(code: string, at: Date = new Date()): boolean {
  const clean = code.replace(/\s/g, "");
  return [at, new Date(at.getTime() - CODE_WINDOW_MS)].some((t) => safeEqual(centerCode(t), clean));
}

export function centerCodeExpiresAt(at: Date = new Date()): Date {
  return new Date((Math.floor(at.getTime() / CODE_WINDOW_MS) + 1) * CODE_WINDOW_MS);
}

/** Proves a kiosk PIN was entered for this guardian in the last two minutes. */
export function signKioskToken(guardianId: string, now: Date = new Date()): string {
  const exp = now.getTime() + KIOSK_TOKEN_TTL_MS;
  return `${guardianId}.${exp}.${hmac("kiosk-token", `${guardianId}.${exp}`)}`;
}

export function verifyKioskToken(token: string, now: Date = new Date()): string | null {
  const [guardianId, exp, sig] = token.split(".");
  if (!guardianId || !exp || !sig) return null;
  if (!safeEqual(sig, hmac("kiosk-token", `${guardianId}.${exp}`))) return null;
  if (Number(exp) < now.getTime()) return null;
  return guardianId;
}
