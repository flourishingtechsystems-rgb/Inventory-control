import { test } from "node:test";
import assert from "node:assert/strict";
import {
  centerCode,
  generatePin,
  isValidPin,
  pinDigest,
  signKioskToken,
  verifyCenterCode,
  verifyKioskToken,
} from "@/lib/presence";

process.env.AUTH_SECRET = "presence-test";

test("PIN rules and digests", () => {
  assert.ok(isValidPin("246813"));
  for (const bad of ["12345", "1234567", "111111", "123456", "abcdef"]) assert.equal(isValidPin(bad), false, bad);
  for (let i = 0; i < 50; i++) assert.ok(isValidPin(generatePin()));
  assert.equal(pinDigest("246813"), pinDigest("246813"));
  assert.notEqual(pinDigest("246813"), pinDigest("246814"));
  assert.ok(!pinDigest("246813").includes("246813"));
});

test("center code rotates every 15 minutes with one window of grace", () => {
  const t = new Date("2026-10-21T08:00:00Z");
  const code = centerCode(t);
  assert.match(code, /^\d{6}$/);
  assert.equal(centerCode(new Date(t.getTime() + 14 * 60_000)), code);
  assert.ok(verifyCenterCode(code, new Date(t.getTime() + 20 * 60_000)));
  assert.equal(verifyCenterCode(code, new Date(t.getTime() + 31 * 60_000)), false);
  assert.equal(verifyCenterCode("000000x", t), false);
});

test("kiosk tokens expire and can't be forged", () => {
  const now = new Date("2026-10-21T08:00:00Z");
  const token = signKioskToken("guardian-1", now);
  assert.equal(verifyKioskToken(token, new Date(now.getTime() + 60_000)), "guardian-1");
  assert.equal(verifyKioskToken(token, new Date(now.getTime() + 3 * 60_000)), null);
  const [, exp, sig] = token.split(".");
  assert.equal(verifyKioskToken(`guardian-2.${exp}.${sig}`, now), null);
  assert.equal(verifyKioskToken("garbage", now), null);
});
