import "server-only"
import { withTenant, type Db } from "@/lib/db"
import { loadCreds, sendText, type WaCreds } from "./client"
import { draftWaReply } from "@/lib/ai/features"
import { loadBrand } from "@/lib/tenant"

/**
 * Processes one webhook payload for a workspace: stores inbound messages,
 * updates delivery statuses for our outbound messages, links conversations to
 * contacts, and fires an auto-reply if the tenant has one configured.
 *
 * Runs inside the tenant transaction, so RLS keeps everything scoped.
 */

type Change = {
  value?: {
    metadata?: { phone_number_id?: string }
    contacts?: { profile?: { name?: string }; wa_id?: string }[]
    messages?: { from: string; id: string; timestamp: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: unknown }[]
    statuses?: { id: string; status: string; recipient_id: string }[]
  }
}
export type WebhookPayload = { entry?: { changes?: Change[] }[] }

export async function processWebhook(workspaceId: string, payload: WebhookPayload) {
  const changes = payload.entry?.flatMap((e) => e.changes ?? []) ?? []
  const toAutoReply: { conversationId: string; phone: string; text: string; name: string | null }[] = []

  await withTenant(workspaceId, async (db) => {
    for (const change of changes) {
      const v = change.value
      if (!v) continue

      // Delivery/read receipts for messages we sent.
      for (const s of v.statuses ?? []) {
        await db.query(
          `update wa_messages set status = $2, error = $3 where wa_message_id = $1 and direction = 'out'`,
          [s.id, s.status, (s as { errors?: { title?: string }[] }).errors?.[0]?.title ?? null],
        )
      }

      const profileName = v.contacts?.[0]?.profile?.name ?? null
      for (const m of v.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? `[${m.type} message]`
        const convo = await upsertConversation(db, m.from, profileName)
        const inserted = await db.one<{ id: number }>(
          `insert into wa_messages (conversation_id, direction, wa_message_id, type, body)
           values ($1,'in',$2,$3,$4) on conflict (workspace_id, wa_message_id) where wa_message_id is not null do nothing returning id`,
          [convo.id, m.id, m.type, text],
        )
        if (!inserted) continue // duplicate delivery of the same webhook
        await db.query(
          `update wa_conversations set last_message_at = now(), last_inbound_at = now(), unread = unread + 1, status = 'open', name = coalesce($2, name) where id = $1`,
          [convo.id, profileName],
        )
        if (m.type === "text" && text) toAutoReply.push({ conversationId: convo.id, phone: m.from, text, name: profileName })
      }
    }
  })

  // Auto-reply happens after the transaction so a slow AI/Graph call can't hold a DB connection.
  if (toAutoReply.length) await runAutoReplies(workspaceId, toAutoReply)
}

async function upsertConversation(db: Db, phone: string, name: string | null) {
  const existing = await db.one<{ id: string }>(`select id from wa_conversations where wa_phone = $1`, [phone])
  if (existing) return existing
  // Link to a contact if we already have this number.
  const contact = await db.one<{ id: string }>(`select id from contacts where regexp_replace(coalesce(phone,''), '\\D', '', 'g') = $1 limit 1`, [phone])
  return (await db.one<{ id: string }>(
    `insert into wa_conversations (wa_phone, name, contact_id, last_message_at, last_inbound_at) values ($1,$2,$3,now(),now()) returning id`,
    [phone, name, contact?.id ?? null],
  ))!
}

async function runAutoReplies(workspaceId: string, items: { conversationId: string; phone: string; text: string; name: string | null }[]) {
  const setup = await withTenant(workspaceId, async (db) => {
    const cfg = await db.one<{ auto_reply: { mode: string; text?: string } }>(`select auto_reply from wa_credentials`)
    return { mode: cfg?.auto_reply?.mode ?? "off", text: cfg?.auto_reply?.text ?? "" }
  })
  if (setup.mode === "off") return

  let creds: WaCreds | null = null
  for (const item of items) {
    let reply = setup.text
    if (setup.mode === "ai") {
      try {
        const ctx = { workspaceId, userId: null }
        const brand = await withTenant(workspaceId, (db) => loadBrand(db, "", null))
        reply = await draftWaReply(ctx, { message: item.text, businessName: brand.name, voice: brand.voice })
      } catch (e) {
        console.error("[wa auto-reply ai]", e)
        continue // don't send a fallback the tenant didn't write
      }
    }
    if (!reply?.trim()) continue
    try {
      creds ??= await withTenant(workspaceId, (db) => loadCreds(db))
      if (!creds) return
      const { wamid } = await sendText(creds, item.phone, reply)
      await withTenant(workspaceId, (db) =>
        db.query(
          `insert into wa_messages (conversation_id, direction, wa_message_id, type, body, status, meta)
           values ($1,'out',$2,'text',$3,'sent','{"auto":true}')`,
          [item.conversationId, wamid, reply],
        ).then(() => db.query(`update wa_conversations set last_message_at = now() where id = $1`, [item.conversationId])),
      )
    } catch (e) {
      console.error("[wa auto-reply send]", e)
    }
  }
}
