import { withTenant } from "@/lib/db"
import { verifySignature } from "@/lib/whatsapp/client"
import { processWebhook } from "@/lib/whatsapp/inbound"
import { unseal } from "@/lib/crypto"

// Per-tenant webhook. The workspace id is in the URL; Meta sends a verify_token
// (checked on GET) and signs POSTs with the tenant's app secret (checked here).

export async function GET(req: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params
  const url = new URL(req.url)
  const mode = url.searchParams.get("hub.mode")
  const token = url.searchParams.get("hub.verify_token")
  const challenge = url.searchParams.get("hub.challenge")
  if (mode !== "subscribe" || !token || !/^[0-9a-f-]{36}$/.test(workspace)) return new Response("Bad request", { status: 400 })

  const row = await withTenant(workspace, (db) => db.one<{ verify_token: string }>(`select verify_token from wa_credentials`)).catch(() => null)
  if (!row || row.verify_token !== token) return new Response("Verification failed", { status: 403 })
  return new Response(challenge ?? "", { status: 200 })
}

export async function POST(req: Request, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params
  if (!/^[0-9a-f-]{36}$/.test(workspace)) return new Response("ok") // never make Meta retry on a bad URL

  const raw = await req.text()
  const secretRow = await withTenant(workspace, (db) => db.one<{ secret_encrypted: string | null }>(`select secret_encrypted from wa_credentials`)).catch(() => null)
  if (!secretRow) return new Response("ok") // not connected; acknowledge so Meta stops retrying

  // If an app secret is configured, require a valid signature.
  if (secretRow.secret_encrypted) {
    const ok = verifySignature(raw, req.headers.get("x-hub-signature-256"), unseal(secretRow.secret_encrypted))
    if (!ok) return new Response("Invalid signature", { status: 401 })
  }

  try {
    await processWebhook(workspace, JSON.parse(raw))
  } catch (e) {
    console.error("[wa webhook]", e)
  }
  return new Response("ok", { status: 200 }) // always 200 so Meta doesn't back off
}
