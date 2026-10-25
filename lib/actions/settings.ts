"use server"

import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { canManage, hashPassword, requireWorkspace } from "@/lib/auth"
import { audit, withGlobal, withTenant } from "@/lib/db"
import { last4, seal } from "@/lib/crypto"
import { PROVIDERS, testKey, friendlyAiError, type Provider } from "@/lib/ai/core"
import { makeTransport, sesConfigSchema, smtpConfigSchema } from "@/lib/email/transport"

export type Result = { ok?: boolean; error?: string; message?: string; tempPassword?: string }

async function manager(slug: string) {
  const ctx = await requireWorkspace(slug)
  if (!canManage(ctx)) throw new Error("Only workspace owners and admins can change settings.")
  return ctx
}

// ─── AI keys (BYOK) ──────────────────────────────────────────────────────────

export async function saveAiKey(slug: string, _: Result, form: FormData): Promise<Result> {
  const ctx = await manager(slug)
  const parsed = z.object({
    provider: z.enum(["openai", "anthropic", "google"]),
    apiKey: z.string().trim().min(20, "That API key looks too short."),
    quality_model: z.string().trim().min(2),
    fast_model: z.string().trim().min(2),
  }).safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { provider, apiKey, quality_model, fast_model } = parsed.data

  // Verify before storing: a key that doesn't work is worse than no key.
  try {
    await testKey(provider as Provider, apiKey, fast_model)
  } catch (e) {
    return { error: friendlyAiError(e) }
  }
  await withTenant(ctx.workspace.id, async (db) => {
    const first = !(await db.one(`select 1 from ai_credentials limit 1`))
    await db.query(
      `insert into ai_credentials (provider, key_encrypted, key_last4, quality_model, fast_model, is_default, last_ok_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (workspace_id, provider) do update set key_encrypted = excluded.key_encrypted, key_last4 = excluded.key_last4,
         quality_model = excluded.quality_model, fast_model = excluded.fast_model, last_ok_at = now()`,
      [provider, seal(apiKey), last4(apiKey), quality_model, fast_model, first],
    )
    await audit(db, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "ai_key.saved", target: provider })
  })
  revalidatePath(`/w/${slug}/settings`)
  return { ok: true, message: `${PROVIDERS[provider as Provider].label} connected and verified.` }
}

export async function removeAiKey(slug: string, provider: Provider) {
  const ctx = await manager(slug)
  await withTenant(ctx.workspace.id, async (db) => {
    await db.query(`delete from ai_credentials where provider = $1`, [provider])
    await db.query(`update ai_credentials set is_default = true where id = (select id from ai_credentials order by created_at limit 1) and not exists (select 1 from ai_credentials where is_default)`)
    await audit(db, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "ai_key.removed", target: provider })
  })
  revalidatePath(`/w/${slug}/settings`)
}

export async function makeDefaultAi(slug: string, provider: Provider) {
  const ctx = await manager(slug)
  await withTenant(ctx.workspace.id, (db) => db.query(`update ai_credentials set is_default = (provider = $1)`, [provider]))
  revalidatePath(`/w/${slug}/settings`)
}

// ─── Email senders (BYOK) ────────────────────────────────────────────────────

export async function saveSender(slug: string, _: Result, form: FormData): Promise<Result> {
  const ctx = await manager(slug)
  const f = Object.fromEntries(form) as Record<string, string>
  const base = z.object({
    provider: z.enum(["ses", "smtp"]),
    from_name: z.string().trim().min(1, "From name is required"),
    from_email: z.string().trim().toLowerCase().email("From email is invalid"),
    reply_to: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  }).safeParse(f)
  if (!base.success) return { error: base.error.issues[0].message }
  const config = base.data.provider === "ses"
    ? sesConfigSchema.safeParse({ region: f.region, accessKeyId: f.accessKeyId, secretAccessKey: f.secretAccessKey })
    : smtpConfigSchema.safeParse({ host: f.host, port: f.port, secure: f.secure === "on", user: f.user, pass: f.pass })
  if (!config.success) return { error: `Check the ${base.data.provider.toUpperCase()} settings: ${config.error.issues[0].path.join(".")} is invalid.` }

  const config_encrypted = seal(JSON.stringify(config.data))
  let verified = false
  try {
    // SMTP can be verified without sending; SES is checked on the first test email.
    if (base.data.provider === "smtp") verified = await makeTransport({ provider: "smtp", config_encrypted }).verify()
  } catch (e) {
    return { error: `Couldn't log in to the SMTP server: ${(e as Error).message}` }
  }
  await withTenant(ctx.workspace.id, async (db) => {
    const first = !(await db.one(`select 1 from sender_identities limit 1`))
    await db.query(
      `insert into sender_identities (provider, from_name, from_email, reply_to, config_encrypted, is_default, last_ok_at) values ($1,$2,$3,$4,$5,$6,$7)`,
      [base.data.provider, base.data.from_name, base.data.from_email, base.data.reply_to || null, config_encrypted, first, verified ? new Date() : null],
    )
    await audit(db, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "sender.saved", target: base.data.from_email })
  })
  revalidatePath(`/w/${slug}/settings`)
  return { ok: true, message: verified ? "Sender connected and verified." : "Sender saved. Send a test email from any campaign to confirm it works." }
}

export async function removeSender(slug: string, id: string) {
  const ctx = await manager(slug)
  await withTenant(ctx.workspace.id, async (db) => {
    await db.query(`delete from sender_identities where id = $1`, [id])
    await db.query(`update sender_identities set is_default = true where id = (select id from sender_identities order by created_at limit 1) and not exists (select 1 from sender_identities where is_default)`)
  })
  revalidatePath(`/w/${slug}/settings`)
}

// ─── Team ────────────────────────────────────────────────────────────────────

export async function inviteTeammate(slug: string, _: Result, form: FormData): Promise<Result> {
  const ctx = await manager(slug)
  const parsed = z.object({
    name: z.string().trim().min(2, "Name is required"),
    email: z.string().trim().toLowerCase().email("Email is invalid"),
    role: z.enum(["admin", "member"]),
  }).safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { name, email, role } = parsed.data
  const password = await withGlobal(async (db) => {
    let pw: string | undefined
    let user = await db.one<{ id: string }>(`select id from users where email = $1`, [email])
    if (!user) {
      pw = randomBytes(9).toString("base64url")
      user = await db.one<{ id: string }>(`insert into users (email, name, password_hash) values ($1,$2,$3) returning id`, [email, name, await hashPassword(pw)])
    }
    await db.query(`insert into memberships (workspace_id, user_id, role) values ($1,$2,$3) on conflict do nothing`, [ctx.workspace.id, user!.id, role])
    await audit(db, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "member.added", target: email, meta: { role } })
    return pw
  })
  revalidatePath(`/w/${slug}/settings`)
  return { ok: true, tempPassword: password, message: password ? `Added ${email}. Share their one-time password:` : `${email} already had a Pollen login and now has access.` }
}

// ─── Brand kit ───────────────────────────────────────────────────────────────

export async function saveBrandKit(slug: string, _: Result, form: FormData): Promise<Result> {
  const ctx = await manager(slug)
  const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours must be hex, like #3d6b4f")
  const parsed = z.object({
    display_name: z.string().trim().min(1, "Display name is required"),
    logo_url: z.string().trim().url("Logo must be a full https:// URL").optional().or(z.literal("")),
    primary_color: hex,
    accent_color: hex,
    website: z.string().trim().url("Website must be a full https:// URL").optional().or(z.literal("")),
    address: z.string().trim().max(300).optional(),
    footer_text: z.string().trim().max(300).optional(),
  }).safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const b = parsed.data
  await withTenant(ctx.workspace.id, (db) =>
    db.query(
      `insert into brand_kits (display_name, logo_url, primary_color, accent_color, website, address, footer_text)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (workspace_id) do update set display_name = excluded.display_name, logo_url = excluded.logo_url,
         primary_color = excluded.primary_color, accent_color = excluded.accent_color, website = excluded.website,
         address = excluded.address, footer_text = excluded.footer_text`,
      [b.display_name, b.logo_url || null, b.primary_color, b.accent_color, b.website || null, b.address || null, b.footer_text || null],
    ),
  )
  revalidatePath(`/w/${slug}/brand`)
  return { ok: true, message: "Brand kit saved." }
}
