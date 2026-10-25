import { notFound } from "next/navigation"
import { requireWorkspace } from "@/lib/auth"
import { withTenant } from "@/lib/db"
import { hasAi } from "@/lib/ai/core"
import { loadBrand, type Audience } from "@/lib/tenant"
import type { Block } from "@/lib/email/blocks"
import type { Scorecard } from "@/lib/ai/features"
import { Editor } from "./editor"
import { SentReport } from "./report"

export const metadata = { title: "Campaign" }

export default async function CampaignPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const ctx = await requireWorkspace(slug)
  const data = await withTenant(ctx.workspace.id, async (db) => {
    const campaign = await db.one<{
      id: string; name: string; subject: string; preview_text: string | null; blocks: Block[]; status: string; audience: Audience
      sender_identity_id: string | null; quality: Scorecard | null; brief: string | null; sent_at: string | null; sent_count: number; failed_count: number; recipients: number
    }>(`select id, name, subject, preview_text, blocks, status, audience, sender_identity_id, quality, brief, sent_at, sent_count, failed_count, recipients from campaigns where id = $1`, [id])
    if (!campaign) return null
    const [lists, segments, senders, brand] = await Promise.all([
      db.query<{ id: string; name: string }>(`select id, name from lists order by name`),
      db.query<{ id: string; name: string }>(`select id, name from segments order by name`),
      db.query<{ id: string; from_name: string; from_email: string; is_default: boolean }>(`select id, from_name, from_email::text as from_email, is_default from sender_identities order by is_default desc, created_at`),
      loadBrand(db, ctx.workspace.name, ctx.workspace.website),
    ])
    let stats = null
    if (campaign.status !== "draft") {
      stats = await db.one<{ opens: number; clicks: number; unsubs: number; bounces: number }>(`
        select count(distinct contact_id) filter (where type = 'open')::int as opens, count(distinct contact_id) filter (where type = 'click')::int as clicks,
               count(*) filter (where type = 'unsubscribe')::int as unsubs, count(*) filter (where type in ('bounce','complaint'))::int as bounces
          from email_events where campaign_id = $1`, [id])
      const links = await db.query<{ url: string; clicks: number }>(`select meta->>'url' as url, count(*)::int as clicks from email_events where campaign_id = $1 and type = 'click' group by 1 order by 2 desc limit 5`, [id])
      stats = { ...stats!, links }
    }
    return { campaign, lists, segments, senders, brand, stats }
  })
  if (!data) notFound()
  const { campaign, brand, stats, ...opts } = data
  const { voice, ...emailBrand } = brand

  if (campaign.status === "sent" || campaign.status === "sending")
    return <SentReport slug={slug} campaign={campaign} brand={emailBrand} stats={stats!} />

  return (
    <Editor
      slug={slug}
      campaign={{ ...campaign, preview_text: campaign.preview_text ?? "" }}
      brand={emailBrand}
      hasVoice={!!voice}
      aiReady={await hasAi(ctx.workspace.id)}
      userEmail={ctx.user.email}
      isDemo={ctx.workspace.is_demo}
      {...opts}
    />
  )
}
