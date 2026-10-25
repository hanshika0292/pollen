"use server"

import { randomUUID } from "crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canManage, requireWorkspace } from "@/lib/auth"
import { audit, withTenant } from "@/lib/db"
import { seal } from "@/lib/crypto"
import { loadBrand, audienceWhere, type Audience } from "@/lib/tenant"
import { loadCreds, sendText, sendTemplate, verifyConnection, listTemplates, WaError, type WaTemplate } from "@/lib/whatsapp/client"
import { draftWaReply } from "@/lib/ai/features"

export type Result = { ok?: boolean; error?: string; message?: string }

async function manager(slug: string) {
  const ctx = await requireWorkspace(slug)
  if (!canManage(ctx)) throw new Error("Only owners and admins can change WhatsApp settings.")
  return ctx
}

const MAX_WA_BROADCAST = 1000

// ─── Connect ───────────────────────────────────────────────────────────────

export async function connectWhatsApp(slug: string, _: Result, form: FormData): Promise<Result> {
  const ctx = await manager(slug)
  const parsed = z.object({
    phone_number_id: z.string().trim().regex(/^\d{5,}$/, "Phone number ID should be all digits."),
    waba_id: z.string().trim().regex(/^\d{5,}$/, "WABA ID should be all digits.").optional().or(z.literal("")),
    token: z.string().trim().min(20, "That access token looks too short."),
    secret: z.string().trim().optional().or(z.literal("")),
  }).safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { phone_number_id, waba_id, token, secret } = parsed.data

  const existing = await withTenant(ctx.workspace.id, (db) => db.one<{ verify_token: string }>(`select verify_token from wa_credentials`))
  const verify_token = existing?.verify_token ?? randomUUID()

  // Verify the token against Graph before saving, and capture the display number.
  let display: string | null = null
  try {
    const info = await verifyConnection({ phone_number_id, waba_id: waba_id || null, token, secret: null, verify_token, graph_version: "v22.0", display_phone: null })
    display = info.display_phone_number ?? null
  } catch (e) {
    return { error: e instanceof WaError ? `Meta rejected the connection: ${e.message}` : "Couldn't reach the WhatsApp API. Check the token and phone number ID." }
  }

  await withTenant(ctx.workspace.id, async (db) => {
    await db.query(
      `insert into wa_credentials (phone_number_id, waba_id, display_phone, token_encrypted, secret_encrypted, verify_token, last_ok_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (workspace_id) do update set phone_number_id = excluded.phone_number_id, waba_id = excluded.waba_id,
         display_phone = excluded.display_phone, token_encrypted = excluded.token_encrypted, secret_encrypted = excluded.secret_encrypted, last_ok_at = now(), last_error = null`,
      [phone_number_id, waba_id || null, display, seal(token), secret ? seal(secret) : null, verify_token],
    )
    await audit(db, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "whatsapp.connected", target: phone_number_id })
  })
  revalidatePath(`/w/${slug}/settings`)
  revalidatePath(`/w/${slug}/whatsapp`)
  return { ok: true, message: display ? `Connected ${display}.` : "Connected." }
}

export async function disconnectWhatsApp(slug: string) {
  const ctx = await manager(slug)
  await withTenant(ctx.workspace.id, (db) => db.query(`delete from wa_credentials`))
  revalidatePath(`/w/${slug}/settings`)
}

export async function setAutoReply(slug: string, _: Result, form: FormData): Promise<Result> {
  const ctx = await manager(slug)
  const mode = String(form.get("mode") ?? "off")
  const text = String(form.get("text") ?? "").trim()
  if (!["off", "away", "ai"].includes(mode)) return { error: "Invalid mode." }
  if (mode === "away" && !text) return { error: "Write the away message to send." }
  await withTenant(ctx.workspace.id, (db) => db.query(`update wa_credentials set auto_reply = $1`, [{ mode, text }]))
  revalidatePath(`/w/${slug}/whatsapp`)
  return { ok: true, message: "Auto-reply updated." }
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

export async function sendReply(slug: string, conversationId: string, body: string): Promise<Result> {
  const ctx = await requireWorkspace(slug)
  if (!body.trim()) return { error: "Type a message." }
  try {
    return await withTenant(ctx.workspace.id, async (db) => {
      const convo = await db.one<{ wa_phone: string; last_inbound_at: string | null }>(`select wa_phone, last_inbound_at from wa_conversations where id = $1`, [conversationId])
      if (!convo) return { error: "Conversation not found." }
      // WhatsApp only allows free-form replies within 24h of the customer's last message.
      const within24h = convo.last_inbound_at && Date.now() - new Date(convo.last_inbound_at).getTime() < 24 * 3600_000
      if (!within24h) return { error: "It's been over 24 hours since their last message — you can only reach them with an approved template now." }
      const creds = await loadCreds(db)
      if (!creds) return { error: "WhatsApp isn't connected." }
      const { wamid } = await sendText(creds, convo.wa_phone, body.trim())
      await db.query(`insert into wa_messages (conversation_id, direction, wa_message_id, type, body, status) values ($1,'out',$2,'text',$3,'sent')`, [conversationId, wamid, body.trim()])
      await db.query(`update wa_conversations set last_message_at = now(), unread = 0 where id = $1`, [conversationId])
      return { ok: true }
    })
  } catch (e) {
    console.error("[wa sendReply]", e)
    return { error: e instanceof WaError ? e.message : "Couldn't send the message." }
  }
}

export async function suggestReply(slug: string, conversationId: string): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const ctx = await requireWorkspace(slug)
  try {
    const data = await withTenant(ctx.workspace.id, async (db) => {
      const msgs = await db.query<{ direction: string; body: string }>(
        `select direction, body from wa_messages where conversation_id = $1 order by created_at desc limit 8`, [conversationId])
      const brand = await loadBrand(db, ctx.workspace.name, ctx.workspace.website)
      return { msgs: msgs.reverse(), brand }
    })
    const lastInbound = [...data.msgs].reverse().find((m) => m.direction === "in")
    if (!lastInbound) return { ok: false, error: "Nothing to reply to yet." }
    const history = data.msgs.map((m) => `${m.direction === "in" ? "Customer" : "Us"}: ${m.body}`).join("\n")
    const reply = await draftWaReply(
      { workspaceId: ctx.workspace.id, userId: ctx.viaAdmin ? null : ctx.user.id },
      { message: lastInbound.body, businessName: data.brand.name, voice: data.brand.voice, history },
    )
    return { ok: true, reply }
  } catch (e) {
    console.error("[wa suggestReply]", e)
    return { ok: false, error: "Couldn't draft a reply." }
  }
}

export async function markRead(slug: string, conversationId: string) {
  const ctx = await requireWorkspace(slug)
  await withTenant(ctx.workspace.id, (db) => db.query(`update wa_conversations set unread = 0 where id = $1`, [conversationId]))
  revalidatePath(`/w/${slug}/whatsapp`)
}

// ─── Templates & broadcast ─────────────────────────────────────────────────

export async function fetchTemplates(slug: string): Promise<{ ok: true; templates: WaTemplate[] } | { ok: false; error: string }> {
  const ctx = await requireWorkspace(slug)
  try {
    const templates = await withTenant(ctx.workspace.id, async (db) => {
      const creds = await loadCreds(db)
      if (!creds) throw new WaError("WhatsApp isn't connected.")
      return listTemplates(creds)
    })
    return { ok: true, templates: templates.filter((t) => t.status === "APPROVED") }
  } catch (e) {
    return { ok: false, error: e instanceof WaError ? e.message : "Couldn't load templates." }
  }
}

const broadcastSchema = z.object({
  name: z.string().trim().min(1),
  template_name: z.string().trim().min(1),
  language: z.string().trim().min(2),
  variables: z.array(z.object({ kind: z.enum(["merge", "literal"]), value: z.string() })).max(10),
  audience: z.union([z.object({ type: z.literal("all") }), z.object({ type: z.enum(["list", "segment"]), id: z.string().uuid() })]),
})

export async function sendWaBroadcast(slug: string, input: z.infer<typeof broadcastSchema>): Promise<Result & { sent?: number; failed?: number }> {
  const ctx = await requireWorkspace(slug)
  if (ctx.workspace.is_demo) return { error: "Sending is disabled in the demo workspace." }
  const parsed = broadcastSchema.safeParse(input)
  if (!parsed.success) return { error: "Check the broadcast details." }
  const b = parsed.data

  try {
    const { creds, recipients, broadcastId } = await withTenant(ctx.workspace.id, async (db) => {
      const creds = await loadCreds(db)
      if (!creds) throw new WaError("WhatsApp isn't connected.")
      const { sql, params } = await audienceWhere(db, b.audience as Audience)
      // Only contacts with a phone number can receive WhatsApp.
      const recipients = await db.query<{ id: string; phone: string; first_name: string | null; last_name: string | null; email: string }>(
        `select id, regexp_replace(phone, '\\D', '', 'g') as phone, first_name, last_name, email::text as email
           from contacts c where ${sql} and coalesce(phone,'') <> '' limit ${MAX_WA_BROADCAST}`, params)
      const row = await db.one<{ id: string }>(
        `insert into wa_broadcasts (name, template_name, language, variables, audience, status, recipients, created_by)
         values ($1,$2,$3,$4,$5,'sending',$6,$7) returning id`,
        [b.name, b.template_name, b.language, JSON.stringify(b.variables), b.audience, recipients.length, ctx.viaAdmin ? null : ctx.user.id])
      return { creds, recipients, broadcastId: row!.id }
    })

    if (recipients.length === 0) return { error: "No contacts in that audience have a phone number." }

    let sent = 0, failed = 0
    for (const r of recipients) {
      const params = b.variables.map((v) => v.kind === "literal" ? v.value : ({
        first_name: r.first_name ?? "there", last_name: r.last_name ?? "", email: r.email,
      } as Record<string, string>)[v.value] ?? "")
      try {
        const { wamid } = await sendTemplate(creds, r.phone, b.template_name, b.language, params)
        sent++
        await withTenant(ctx.workspace.id, async (db) => {
          const convo = await db.one<{ id: string }>(
            `insert into wa_conversations (wa_phone, contact_id, last_message_at) values ($1,$2,now())
             on conflict (workspace_id, wa_phone) do update set last_message_at = now() returning id`, [r.phone, r.id])
          await db.query(`insert into wa_messages (conversation_id, direction, wa_message_id, type, body, template_name, status) values ($1,'out',$2,'template',$3,$4,'sent')`,
            [convo!.id, wamid, `[template: ${b.template_name}]`, b.template_name])
        })
      } catch (e) {
        failed++
        console.error("[wa broadcast]", (e as Error).message)
      }
    }
    await withTenant(ctx.workspace.id, async (db) => {
      await db.query(`update wa_broadcasts set status = $2, sent_count = $3, failed_count = $4, sent_at = now() where id = $1`,
        [broadcastId, sent === 0 && failed > 0 ? "failed" : "sent", sent, failed])
      await audit(db, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "whatsapp.broadcast", target: b.template_name, meta: { sent, failed } })
    })
    revalidatePath(`/w/${slug}/whatsapp`)
    return sent === 0 ? { error: `All ${failed} sends failed. Check the template name and that recipients have opted in.` } : { ok: true, sent, failed, message: `Sent to ${sent}${failed ? ` · ${failed} failed` : ""}.` }
  } catch (e) {
    console.error("[wa broadcast]", e)
    return { error: e instanceof WaError ? e.message : "Broadcast failed." }
  }
}

export type ThreadMessage = { id: number; direction: "in" | "out"; body: string | null; type: string; status: string | null; template_name: string | null; created_at: string; auto: boolean }

export async function loadThread(slug: string, conversationId: string): Promise<{ messages: ThreadMessage[]; canFreeform: boolean; phone: string; name: string | null; contactId: string | null }> {
  const ctx = await requireWorkspace(slug)
  return withTenant(ctx.workspace.id, async (db) => {
    const convo = await db.one<{ wa_phone: string; name: string | null; last_inbound_at: string | null; contact_id: string | null }>(
      `select wa_phone, name, last_inbound_at, contact_id from wa_conversations where id = $1`, [conversationId])
    if (!convo) return { messages: [], canFreeform: false, phone: "", name: null, contactId: null }
    await db.query(`update wa_conversations set unread = 0 where id = $1`, [conversationId])
    const rows = await db.query<{ id: number; direction: "in" | "out"; body: string | null; type: string; status: string | null; template_name: string | null; created_at: string; meta: { auto?: boolean } }>(
      `select id, direction, body, type, status, template_name, created_at, meta from wa_messages where conversation_id = $1 order by created_at asc limit 200`, [conversationId])
    const canFreeform = !!convo.last_inbound_at && Date.now() - new Date(convo.last_inbound_at).getTime() < 24 * 3600_000
    return {
      messages: rows.map((r) => ({ id: r.id, direction: r.direction, body: r.body, type: r.type, status: r.status, template_name: r.template_name, created_at: r.created_at, auto: !!r.meta?.auto })),
      canFreeform, phone: convo.wa_phone, name: convo.name, contactId: convo.contact_id,
    }
  })
}
