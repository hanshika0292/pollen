import "server-only"
import { withTenant } from "@/lib/db"
import { signToken } from "@/lib/crypto"
import { audienceWhere, loadBrand, type Audience } from "@/lib/tenant"
import type { Block } from "./blocks"
import { renderEmail, mergeTags, type Recipient } from "./render"
import { makeTransport, sendOne, type SenderRow } from "./transport"

export const MAX_RECIPIENTS_PER_SEND = 2000 // v0.1: sends run in-request; bigger lists need the queue (Phase 3)

type LinkToken = { w: string; c: string; k: string; u?: string }

export function trackingUrls(base: string, workspaceId: string, campaignId: string, contactId: string) {
  const t = (extra: Partial<LinkToken> = {}) => signToken({ w: workspaceId, c: campaignId, k: contactId, ...extra })
  return {
    open: `${base}/api/t/o/${t()}`,
    click: (url: string) => `${base}/api/t/c/${t({ u: url })}`,
    unsubscribe: `${base}/api/u/${t()}`,
  }
}

async function loadForSend(workspaceId: string, campaignId: string) {
  return withTenant(workspaceId, async (db) => {
    const campaign = await db.one<{
      id: string; name: string; subject: string; preview_text: string | null; blocks: Block[]
      status: string; audience: Audience; sender_identity_id: string | null
    }>(`select id, name, subject, preview_text, blocks, status, audience, sender_identity_id from campaigns where id = $1`, [campaignId])
    if (!campaign) throw new Error("Campaign not found.")
    const sender = await db.one<SenderRow>(
      `select id, provider, from_name, from_email, reply_to, config_encrypted from sender_identities
        where ($1::uuid is not null and id = $1) or ($1::uuid is null and is_default) order by is_default desc limit 1`,
      [campaign.sender_identity_id],
    )
    const ws = await db.one<{ name: string; website: string | null }>(`select name, website from workspaces where id = $1`, [workspaceId])
    const brand = await loadBrand(db, ws!.name, ws!.website)
    return { campaign, sender, brand }
  })
}

export async function sendTest(opts: { workspaceId: string; campaignId: string; to: string; firstName: string }) {
  const { campaign, sender, brand } = await loadForSend(opts.workspaceId, opts.campaignId)
  if (!sender) throw new Error("Connect an email sender in Settings → Email sending first.")
  const recipient: Recipient = { email: opts.to, first_name: opts.firstName }
  const html = renderEmail({ blocks: campaign.blocks, previewText: campaign.preview_text, brand, recipient, unsubscribeUrl: "#" })
  await sendOne(makeTransport(sender), sender, { to: opts.to, subject: `[Test] ${mergeTags(campaign.subject, recipient)}`, html }, 1)
}

export async function sendCampaign(opts: { workspaceId: string; campaignId: string; base: string }) {
  const { campaign, sender, brand } = await loadForSend(opts.workspaceId, opts.campaignId)
  if (!["draft", "failed"].includes(campaign.status)) throw new Error("This campaign has already been sent.")
  if (!sender) throw new Error("Connect an email sender in Settings → Email sending first.")
  if (!brand.address) throw new Error("Add your business address in Brand Kit — it's legally required in marketing emails.")
  if (!campaign.subject.trim() || campaign.blocks.length === 0) throw new Error("Add a subject and some content first.")

  const transport = makeTransport(sender) // fail fast on bad credentials, before claiming

  // Claim the campaign atomically so a double-click can't send twice.
  const contacts = await withTenant(opts.workspaceId, async (db) => {
    const claimed = await db.one(`update campaigns set status = 'sending' where id = $1 and status in ('draft','failed') returning id`, [campaign.id])
    if (!claimed) throw new Error("This campaign is already sending.")
    const { sql, params } = await audienceWhere(db, campaign.audience)
    const rows = await db.query<Recipient & { id: string }>(
      `select c.id, c.email::text as email, c.first_name, c.last_name, c.attributes from contacts c
        where ${sql} and not exists (select 1 from email_events e where e.campaign_id = $${params.length + 1} and e.contact_id = c.id and e.type = 'sent')
        order by c.created_at limit ${MAX_RECIPIENTS_PER_SEND}`,
      [...params, campaign.id],
    )
    await db.query(`update campaigns set recipients = $2 where id = $1`, [campaign.id, rows.length])
    return rows
  })

  const sent: string[] = []
  const failed: { id: string; error: string }[] = []

  const queue = [...contacts]
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const links = trackingUrls(opts.base, opts.workspaceId, campaign.id, c.id)
      const html = renderEmail({
        blocks: campaign.blocks, previewText: campaign.preview_text, brand, recipient: c,
        rewriteLink: links.click, unsubscribeUrl: links.unsubscribe, openPixelUrl: links.open,
      })
      try {
        await sendOne(transport, sender, {
          to: c.email, subject: mergeTags(campaign.subject, c), html,
          headers: { "List-Unsubscribe": `<${links.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        })
        sent.push(c.id)
      } catch (err) {
        failed.push({ id: c.id, error: String((err as Error)?.message ?? err).slice(0, 300) })
      }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker))

  await withTenant(opts.workspaceId, async (db) => {
    if (sent.length)
      await db.query(
        `insert into email_events (campaign_id, contact_id, type) select $1, unnest($2::uuid[]), 'sent' on conflict do nothing`,
        [campaign.id, sent],
      )
    for (const f of failed)
      await db.query(`insert into email_events (campaign_id, contact_id, type, meta) values ($1, $2, 'failed', $3)`, [campaign.id, f.id, { error: f.error }])
    await db.query(
      `update campaigns set status = $2, sent_count = sent_count + $3, failed_count = failed_count + $4, sent_at = coalesce(sent_at, now()) where id = $1`,
      [campaign.id, sent.length === 0 && failed.length > 0 ? "failed" : "sent", sent.length, failed.length],
    )
  })

  return { sent: sent.length, failed: failed.length, firstError: failed[0]?.error }
}
