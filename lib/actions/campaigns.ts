"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { requireWorkspace } from "@/lib/auth"
import { audit, withTenant } from "@/lib/db"
import { baseUrl } from "@/lib/tenant"
import { blockSchema } from "@/lib/email/blocks"
import { sendCampaign, sendTest } from "@/lib/email/campaign"

export async function createCampaign(slug: string) {
  const ctx = await requireWorkspace(slug)
  const row = await withTenant(ctx.workspace.id, (db) =>
    db.one<{ id: string }>(`insert into campaigns (name, created_by) values ($1, $2) returning id`, [
      `Untitled campaign · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
      ctx.viaAdmin ? null : ctx.user.id,
    ]),
  )
  redirect(`/w/${slug}/campaigns/${row!.id}`)
}

const saveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().max(200),
  preview_text: z.string().max(300),
  blocks: z.array(blockSchema).max(40),
  audience: z.union([z.object({ type: z.literal("all") }), z.object({ type: z.enum(["list", "segment"]), id: z.string().uuid() })]),
  sender_identity_id: z.string().uuid().nullable(),
})
export type CampaignDraft = z.infer<typeof saveSchema>

export async function saveCampaign(slug: string, id: string, draft: CampaignDraft): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireWorkspace(slug)
  const parsed = saveSchema.safeParse(draft)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }
  const d = parsed.data
  const row = await withTenant(ctx.workspace.id, (db) =>
    db.one(
      `update campaigns set name = $2, subject = $3, preview_text = $4, blocks = $5, audience = $6, sender_identity_id = $7
        where id = $1 and status in ('draft','failed') returning id`,
      [id, d.name, d.subject, d.preview_text, JSON.stringify(d.blocks), d.audience, d.sender_identity_id],
    ),
  )
  if (!row) return { ok: false, error: "Sent campaigns can't be edited." }
  return { ok: true }
}

export async function sendTestEmail(slug: string, id: string, to: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireWorkspace(slug)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: "Enter a valid email address." }
  try {
    await sendTest({ workspaceId: ctx.workspace.id, campaignId: id, to, firstName: ctx.user.name.split(" ")[0] })
    return { ok: true }
  } catch (e) {
    console.error("[sendTest]", e)
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't send the test." }
  }
}

export async function sendNow(slug: string, id: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  const ctx = await requireWorkspace(slug)
  if (ctx.workspace.is_demo) return { ok: false, error: "This is a demo workspace — sending to its example.com contacts is disabled." }
  try {
    const r = await sendCampaign({ workspaceId: ctx.workspace.id, campaignId: id, base: await baseUrl() })
    await withTenant(ctx.workspace.id, (db) => audit(db, { workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, action: "campaign.sent", target: id, meta: r }))
    revalidatePath(`/w/${slug}/campaigns`)
    revalidatePath(`/w/${slug}/campaigns/${id}`)
    if (r.sent === 0 && r.failed > 0) return { ok: false, error: `Nothing was delivered. First error: ${r.firstError}` }
    return { ok: true, message: `Sent to ${r.sent.toLocaleString("en-IN")} people${r.failed ? ` · ${r.failed} failed` : ""}.` }
  } catch (e) {
    console.error("[sendNow]", e)
    return { ok: false, error: e instanceof Error ? e.message : "Sending failed." }
  }
}

export async function duplicateCampaign(slug: string, id: string) {
  const ctx = await requireWorkspace(slug)
  const row = await withTenant(ctx.workspace.id, (db) =>
    db.one<{ id: string }>(
      `insert into campaigns (name, subject, preview_text, blocks, audience, sender_identity_id, brief, created_by)
       select name || ' (copy)', subject, preview_text, blocks, audience, sender_identity_id, brief, $2 from campaigns where id = $1 returning id`,
      [id, ctx.viaAdmin ? null : ctx.user.id],
    ),
  )
  redirect(`/w/${slug}/campaigns/${row!.id}`)
}

export async function deleteCampaign(slug: string, id: string) {
  const ctx = await requireWorkspace(slug)
  await withTenant(ctx.workspace.id, (db) => db.query(`delete from campaigns where id = $1 and status in ('draft','failed')`, [id]))
  revalidatePath(`/w/${slug}/campaigns`)
  redirect(`/w/${slug}/campaigns`)
}
