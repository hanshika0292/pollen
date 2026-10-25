import "server-only"
import { createHmac, timingSafeEqual } from "crypto"
import { withTenant, type Db } from "@/lib/db"
import { unseal } from "@/lib/crypto"

/**
 * WhatsApp Cloud API client — one connection per workspace (BYOK).
 * Tenants store their own phone_number_id + permanent token; Pollen calls the
 * Graph API on their behalf. Nothing here is shared across tenants.
 */

export type WaCreds = {
  phone_number_id: string
  waba_id: string | null
  display_phone: string | null
  token: string
  secret: string | null
  verify_token: string
  graph_version: string
}

type WaCredsRow = {
  phone_number_id: string
  waba_id: string | null
  display_phone: string | null
  token_encrypted: string
  secret_encrypted: string | null
  verify_token: string
  graph_version: string
}

export async function loadCreds(db: Db): Promise<WaCreds | null> {
  const row = await db.one<WaCredsRow>(
    `select phone_number_id, waba_id, display_phone, token_encrypted, secret_encrypted, verify_token, graph_version from wa_credentials`,
  )
  if (!row) return null
  return {
    phone_number_id: row.phone_number_id,
    waba_id: row.waba_id,
    display_phone: row.display_phone,
    token: unseal(row.token_encrypted),
    secret: row.secret_encrypted ? unseal(row.secret_encrypted) : null,
    verify_token: row.verify_token,
    graph_version: row.graph_version,
  }
}

function graph(creds: Pick<WaCreds, "graph_version">, path: string) {
  return `https://graph.facebook.com/${creds.graph_version}/${path}`
}

async function call<T = unknown>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(20_000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = (json as { error?: { message?: string; error_user_msg?: string } }).error
    throw new WaError(err?.error_user_msg || err?.message || `Graph API error ${res.status}`, res.status)
  }
  return json as T
}

export class WaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

/** Confirm the token works and return the connected number's details. */
export async function verifyConnection(creds: WaCreds) {
  return call<{ id: string; display_phone_number?: string; verified_name?: string }>(
    graph(creds, `${creds.phone_number_id}?fields=display_phone_number,verified_name`),
    creds.token,
  )
}

export type SendResult = { wamid: string }

export async function sendText(creds: WaCreds, to: string, body: string): Promise<SendResult> {
  const json = await call<{ messages: { id: string }[] }>(graph(creds, `${creds.phone_number_id}/messages`), creds.token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: true, body } }),
  })
  return { wamid: json.messages[0].id }
}

export type TemplateComponent = { type: string; parameters: { type: string; text: string }[] }

export async function sendTemplate(
  creds: WaCreds,
  to: string,
  templateName: string,
  language: string,
  bodyParams: string[],
): Promise<SendResult> {
  const components: TemplateComponent[] = bodyParams.length
    ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
    : []
  const json = await call<{ messages: { id: string }[] }>(graph(creds, `${creds.phone_number_id}/messages`), creds.token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: templateName, language: { code: language }, ...(components.length ? { components } : {}) },
    }),
  })
  return { wamid: json.messages[0].id }
}

export type WaTemplate = {
  name: string
  language: string
  status: string
  category: string
  bodyText: string
  variableCount: number
}

/** List the tenant's approved message templates (for the broadcast composer). */
export async function listTemplates(creds: WaCreds): Promise<WaTemplate[]> {
  if (!creds.waba_id) throw new WaError("Add your WhatsApp Business Account (WABA) ID to list templates.")
  const json = await call<{ data: { name: string; status: string; category: string; language: string; components: { type: string; text?: string }[] }[] }>(
    graph(creds, `${creds.waba_id}/message_templates?fields=name,status,category,language,components&limit=100`),
    creds.token,
  )
  return json.data.map((t) => {
    const body = t.components.find((c) => c.type === "BODY")?.text ?? ""
    return {
      name: t.name,
      language: t.language,
      status: t.status,
      category: t.category,
      bodyText: body,
      variableCount: [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].reduce((m, x) => Math.max(m, Number(x[1])), 0),
    }
  })
}

/** Verify a webhook POST came from Meta (HMAC-SHA256 of the raw body with the app secret). */
export function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex")
  const got = signatureHeader.slice(7)
  if (got.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}

/** Convenience for server actions: run something with a workspace's WA creds. */
export async function withCreds<T>(workspaceId: string, fn: (creds: WaCreds, db: Db) => Promise<T>): Promise<T> {
  return withTenant(workspaceId, async (db) => {
    const creds = await loadCreds(db)
    if (!creds) throw new WaError("WhatsApp isn't connected for this workspace.")
    return fn(creds, db)
  })
}
