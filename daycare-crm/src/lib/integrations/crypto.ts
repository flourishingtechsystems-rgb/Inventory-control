// AES-256-GCM encryption for OAuth tokens at rest.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const configured = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (configured) {
    const buf = Buffer.from(configured, "base64");
    if (buf.length !== 32) {
      throw new Error("INTEGRATION_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
    }
    return buf;
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Set INTEGRATION_ENCRYPTION_KEY (or AUTH_SECRET) to store tokens.");
  return createHash("sha256").update(`nestwise-integrations:${secret}`).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decrypt(token: string): string {
  const [version, iv, tag, data] = token.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised token format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
