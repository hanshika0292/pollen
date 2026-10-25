import Link from "next/link"
import { Check, Circle, Sparkles } from "lucide-react"
import { requireWorkspace } from "@/lib/auth"
import { withTenant } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { PageHeader, Panel, Stat, Pill, STATUS_TONE, fmtDate, fmtNum, pct } from "@/components/pollen/ui"
import { createCampaign } from "@/lib/actions/campaigns"
import { EngagementChart } from "./engagement-chart"

export const metadata = { title: "Home" }

export default async function WorkspaceHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireWorkspace(slug)
  const d = await withTenant(ctx.workspace.id, async (db) => {
    const [counts, recent, daily, setup] = await Promise.all([
      db.one<{ contacts: number; subscribed: number; new_30d: number; sent_30d: number; opens_30d: number; clicks_30d: number; unsubs_30d: number }>(`
        select count(*)::int as contacts,
               count(*) filter (where status = 'subscribed')::int as subscribed,
               count(*) filter (where created_at > now() - interval '30 days')::int as new_30d,
               (select count(*) from email_events where type = 'sent' and occurred_at > now() - interval '30 days')::int as sent_30d,
               (select count(distinct (campaign_id, contact_id)) from email_events where type = 'open' and occurred_at > now() - interval '30 days')::int as opens_30d,
               (select count(distinct (campaign_id, contact_id)) from email_events where type = 'click' and occurred_at > now() - interval '30 days')::int as clicks_30d,
               (select count(*) from email_events where type = 'unsubscribe' and occurred_at > now() - interval '30 days')::int as unsubs_30d
          from contacts`),
      db.query<{ id: string; name: string; status: string; sent_at: string | null; created_at: string; sent_count: number; opens: number; clicks: number }>(`
        select c.id, c.name, c.status, c.sent_at, c.created_at, c.sent_count,
               (select count(distinct contact_id) from email_events e where e.campaign_id = c.id and e.type = 'open')::int as opens,
               (select count(distinct contact_id) from email_events e where e.campaign_id = c.id and e.type = 'click')::int as clicks
          from campaigns c order by coalesce(c.sent_at, c.created_at) desc limit 5`),
      db.query<{ day: string; opens: number; clicks: number }>(`
        select to_char(d, 'DD Mon') as day,
               (select count(*) from email_events where type = 'open' and occurred_at::date = d)::int as opens,
               (select count(*) from email_events where type = 'click' and occurred_at::date = d)::int as clicks
          from generate_series(current_date - 29, current_date, interval '1 day') d order by d`),
      db.one<{ ai: boolean; sender: boolean; voice: boolean; address: boolean; contacts: boolean; sent: boolean }>(`
        select exists (select 1 from ai_credentials) as ai, exists (select 1 from sender_identities) as sender,
               exists (select 1 from brand_kits where voice is not null) as voice, exists (select 1 from brand_kits where coalesce(address,'') <> '') as address,
               exists (select 1 from contacts) as contacts, exists (select 1 from campaigns where status = 'sent') as sent`),
    ])
    return { counts: counts!, recent, daily, setup: setup! }
  })
  const { counts, recent, daily, setup } = d
  const steps = [
    { done: setup.ai, label: "Connect your AI provider key", href: "settings" },
    { done: setup.voice, label: "Teach Pollen your brand voice", href: "brand" },
    { done: setup.address, label: "Add your business address", href: "brand" },
    { done: setup.sender, label: "Connect an email sender", href: "settings" },
    { done: setup.contacts, label: "Import your contacts", href: "contacts" },
    { done: setup.sent, label: "Send your first campaign", href: "campaigns" },
  ]
  const remaining = steps.filter((s) => !s.done).length

  return (
    <>
      <PageHeader
        title={`Good to see you, ${ctx.user.name.split(" ")[0]}`}
        description={`Here's how ${ctx.workspace.name} is growing.`}
        actions={<form action={createCampaign.bind(null, slug)}><Button type="submit"><Sparkles /> New campaign</Button></form>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Subscribed contacts" value={fmtNum(counts.subscribed)} hint={`+${fmtNum(counts.new_30d)} in the last 30 days`} />
        <Stat label="Emails sent · 30d" value={fmtNum(counts.sent_30d)} />
        <Stat label="Open rate · 30d" value={pct(counts.opens_30d, counts.sent_30d)} hint={`${fmtNum(counts.opens_30d)} unique opens`} />
        <Stat label="Click rate · 30d" value={pct(counts.clicks_30d, counts.sent_30d)} hint={`${fmtNum(counts.unsubs_30d)} unsubscribes`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Panel title="Engagement" description="Opens and clicks over the last 30 days.">
            <EngagementChart data={daily} />
          </Panel>
          <Panel title="Recent campaigns" actions={<Link href={`/w/${slug}/campaigns`} className="text-sm text-primary hover:underline">All campaigns</Link>}>
            {recent.length === 0 ? <p className="text-sm text-muted-foreground">No campaigns yet.</p> : (
              <ul className="divide-y">
                {recent.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/w/${slug}/campaigns/${c.id}`} className="block truncate font-medium hover:underline">{c.name}</Link>
                      <p className="text-xs text-muted-foreground">{c.status === "sent" ? `Sent ${fmtDate(c.sent_at)} to ${fmtNum(c.sent_count)}` : `Created ${fmtDate(c.created_at)}`}</p>
                    </div>
                    {c.status === "sent" ? (
                      <div className="flex shrink-0 gap-4 text-right text-sm tabular-nums">
                        <div><p className="font-medium">{pct(c.opens, c.sent_count)}</p><p className="text-xs text-muted-foreground">opened</p></div>
                        <div><p className="font-medium">{pct(c.clicks, c.sent_count)}</p><p className="text-xs text-muted-foreground">clicked</p></div>
                      </div>
                    ) : <Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <Panel title={remaining ? "Get set up" : "You're all set"} description={remaining ? `${steps.length - remaining} of ${steps.length} done` : "Everything's connected."}>
          <ol className="space-y-1">
            {steps.map((s) => (
              <li key={s.label}>
                <Link href={`/w/${slug}/${s.href}`} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted">
                  {s.done ? <Check className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                  <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  )
}
