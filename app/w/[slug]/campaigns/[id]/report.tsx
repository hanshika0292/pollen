import Link from "next/link"
import { renderEmail, type Brand } from "@/lib/email/render"
import type { Block } from "@/lib/email/blocks"
import { duplicateCampaign } from "@/lib/actions/campaigns"
import { Button } from "@/components/ui/button"
import { PageHeader, Panel, Stat, Pill, STATUS_TONE, fmtDate, fmtNum, pct } from "@/components/pollen/ui"

export function SentReport({ slug, campaign, brand, stats }: {
  slug: string
  campaign: { id: string; name: string; subject: string; preview_text: string | null; blocks: Block[]; status: string; sent_at: string | null; sent_count: number; failed_count: number }
  brand: Brand
  stats: { opens: number; clicks: number; unsubs: number; bounces: number; links: { url: string; clicks: number }[] }
}) {
  const html = renderEmail({ blocks: campaign.blocks, previewText: campaign.preview_text, brand, unsubscribeUrl: "#" })
  return (
    <>
      <div className="mb-2 text-sm"><Link href={`/w/${slug}/campaigns`} className="text-muted-foreground hover:text-foreground">← Campaigns</Link></div>
      <PageHeader
        title={campaign.name}
        description={`“${campaign.subject}” · ${campaign.status === "sending" ? "sending now" : `sent ${fmtDate(campaign.sent_at)}`}`}
        actions={<><Pill tone={STATUS_TONE[campaign.status]}>{campaign.status}</Pill><form action={duplicateCampaign.bind(null, slug, campaign.id)}><Button variant="outline" type="submit">Duplicate</Button></form></>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Delivered" value={fmtNum(campaign.sent_count)} hint={campaign.failed_count ? `${campaign.failed_count} failed` : undefined} />
        <Stat label="Opened" value={pct(stats.opens, campaign.sent_count)} hint={`${fmtNum(stats.opens)} people`} />
        <Stat label="Clicked" value={pct(stats.clicks, campaign.sent_count)} hint={`${fmtNum(stats.clicks)} people`} />
        <Stat label="Click-to-open" value={pct(stats.clicks, stats.opens)} />
        <Stat label="Unsubscribed" value={fmtNum(stats.unsubs)} hint={stats.bounces ? `${stats.bounces} bounced` : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Panel title="Top links">
          {stats.links.length === 0 ? <p className="text-sm text-muted-foreground">No clicks yet.</p> : (
            <ul className="space-y-2 text-sm">{stats.links.map((l) => <li key={l.url} className="flex justify-between gap-3"><span className="truncate">{l.url}</span><span className="tabular-nums text-muted-foreground">{l.clicks}</span></li>)}</ul>
          )}
        </Panel>
        <Panel title="What was sent">
          <iframe title="Sent email" srcDoc={html} sandbox="" className="h-[560px] w-full rounded-md border bg-white" />
        </Panel>
      </div>
    </>
  )
}
