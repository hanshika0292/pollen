import "server-only"
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto"

/**
 * Secrets at rest (BYOK API keys, SMTP/SES credentials) are sealed with
 * AES-256-GCM before they touch the database. ENCRYPTION_KEY is 32 random
 * bytes, base64-encoded, and lives only in the deployment environment.
 */

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error("ENCRYPTION_KEY is not set")
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded")
  return buf
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".")
}

export function unseal(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".")
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised secret format")
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")
}

/**
 * Signed, URL-safe tokens for public links (open pixel, click redirect,
 * unsubscribe). The payload names the workspace, so the public handler knows
 * which tenant context to open without trusting anything else in the URL.
 */
function hmacKey(): Buffer {
  return createHmac("sha256", key()).update("pollen-link-tokens").digest()
}

export function signToken(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = createHmac("sha256", hmacKey()).update(body).digest("base64url").slice(0, 22)
  return `${body}.${sig}`
}

export function verifyToken<T>(token: string): T | null {
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  const expected = createHmac("sha256", hmacKey()).update(body).digest("base64url").slice(0, 22)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T
  } catch {
    return null
  }
}

export function last4(secret: string) {
  return secret.trim().slice(-4)
}
