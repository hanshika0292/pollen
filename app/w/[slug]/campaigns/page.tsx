import Link from "next/link"
import { Sparkles } from "lucide-react"
import { requireWorkspace } from "@/lib/auth"
import { withTenant } from "@/lib/db"
import { createCampaign } from "@/lib/actions/campaigns"
import { Button } from "@/components/ui/button"
import { PageHeader, Pill, STATUS_TONE, Empty, fmtDate, fmtNum, pct } from "@/components/pollen/ui"

export const metadata = { title: "Campaigns" }

export default async function CampaignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireWorkspace(slug)
  const rows = await withTenant(ctx.workspace.id, (db) =>
    db.query<{ id: string; name: string; subject: string; status: string; created_at: string; sent_at: string | null; sent_count: number; opens: number; clicks: number; quality: { overall?: number } | null }>(`
      select c.id, c.name, c.subject, c.status, c.created_at, c.sent_at, c.sent_count, c.quality,
             (select count(distinct contact_id) from email_events e where e.campaign_id = c.id and e.type = 'open')::int as opens,
             (select count(distinct contact_id) from email_events e where e.campaign_id = c.id and e.type = 'click')::int as clicks
        from campaigns c order by coalesce(c.sent_at, c.updated_at) desc`),
  )
  const newButton = <form action={createCampaign.bind(null, slug)}><Button type="submit"><Sparkles /> New campaign</Button></form>
  return (
    <>
      <PageHeader title="Campaigns" description="Write with AI, check quality, then send to the right people." actions={newButton} />
      {rows.length === 0 ? <Empty title="No campaigns yet" action={newButton}>Start one and let Pollen draft it in your brand voice.</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3 font-medium">Campaign</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Quality</th><th className="px-4 py-3 text-right font-medium">Sent</th><th className="px-4 py-3 text-right font-medium">Opened</th><th className="px-4 py-3 text-right font-medium">Clicked</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link href={`/w/${slug}/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <p className="max-w-md truncate text-xs text-muted-foreground">{c.subject || "No subject yet"} · {c.sent_at ? `sent ${fmtDate(c.sent_at)}` : `created ${fmtDate(c.created_at)}`}</p>
                  </td>
                  <td className="px-4 py-3"><Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill></td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.quality?.overall ? `${c.quality.overall}/10` : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.status === "sent" ? fmtNum(c.sent_count) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.status === "sent" ? pct(c.opens, c.sent_count) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.status === "sent" ? pct(c.clicks, c.sent_count) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
