import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowUpRight } from "lucide-react"
import { withAdmin } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { PageHeader, Panel, Pill, Stat, STATUS_TONE, fmtDate, fmtNum } from "@/components/pollen/ui"
import { PROVIDERS, type Provider } from "@/lib/ai/core"
import { TenantSettingsForm, AddMemberForm, RemoveMemberButton } from "./forms"

export const metadata = { title: "Tenant" }

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const data = await withAdmin(async (db) => {
    const ws = await db.one<{ id: string; slug: string; name: string; industry: string | null; website: string | null; plan: string; status: string; is_demo: boolean; notes: string | null; created_at: string }>(
      `select id, slug, name, industry, website, plan, status, is_demo, notes, created_at from workspaces where id = $1`, [id])
    if (!ws) return null
    const [members, ai, senders, usage, stats, activity] = await Promise.all([
      db.query<{ id: string; name: string; email: string; role: string; last_login_at: string | null }>(
        `select u.id, u.name, u.email::text as email, m.role, u.last_login_at from memberships m join users u on u.id = m.user_id where m.workspace_id = $1 order by m.created_at`, [id]),
      db.query<{ provider: Provider; key_last4: string; quality_model: string; fast_model: string; is_default: boolean; last_ok_at: string | null }>(
        `select provider, key_last4, quality_model, fast_model, is_default, last_ok_at from ai_credentials where workspace_id = $1`, [id]),
      db.query<{ provider: string; from_email: string; is_default: boolean; last_ok_at: string | null }>(
        `select provider, from_email::text as from_email, is_default, last_ok_at from sender_identities where workspace_id = $1`, [id]),
      db.query<{ feature: string; calls: number; errors: number; tokens: number; avg_ms: number; avg_quality: number | null }>(
        `select feature, count(*)::int as calls, count(*) filter (where status = 'error')::int as errors,
                coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0)::int as tokens,
                coalesce(avg(latency_ms),0)::int as avg_ms, round(avg(quality_score),1)::float as avg_quality
           from ai_runs where workspace_id = $1 and created_at > now() - interval '30 days' group by feature order by calls desc`, [id]),
      db.one<{ contacts: number; subscribed: number; campaigns_sent: number; emails_30d: number }>(
        `select (select count(*) from contacts where workspace_id = $1)::int as contacts,
                (select count(*) from contacts where workspace_id = $1 and status = 'subscribed')::int as subscribed,
                (select count(*) from campaigns where workspace_id = $1 and status = 'sent')::int as campaigns_sent,
                (select count(*) from email_events where workspace_id = $1 and type = 'sent' and occurred_at > now() - interval '30 days')::int as emails_30d`, [id]),
      db.query<{ id: number; action: string; target: string | null; created_at: string; actor: string | null }>(
        `select a.id, a.action, a.target, a.created_at, u.email::text as actor from audit_log a left join users u on u.id = a.actor_user_id
          where a.workspace_id = $1 order by a.created_at desc limit 12`, [id]),
    ])
    return { ws, members, ai, senders, usage, stats: stats!, activity }
  })
  if (!data) notFound()
  const { ws, members, ai, senders, usage, stats, activity } = data

  return (
    <>
      <div className="mb-2 text-sm"><Link href="/admin" className="text-muted-foreground hover:text-foreground">← Tenants</Link></div>
      <PageHeader
        title={ws.name}
        description={[`/w/${ws.slug}`, ws.industry, ws.website].filter(Boolean).join(" · ")}
        actions={<Button asChild variant="outline"><Link href={`/w/${ws.slug}`}>Open workspace <ArrowUpRight /></Link></Button>}
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <Pill tone={STATUS_TONE[ws.status]}>{ws.status}</Pill>
        <Pill tone="blue">{ws.plan}</Pill>
        {ws.is_demo && <Pill tone="honey">demo tenant</Pill>}
        <Pill>since {fmtDate(ws.created_at)}</Pill>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Contacts" value={fmtNum(stats.contacts)} hint={`${fmtNum(stats.subscribed)} subscribed`} />
        <Stat label="Campaigns sent" value={fmtNum(stats.campaigns_sent)} />
        <Stat label="Emails · 30 days" value={fmtNum(stats.emails_30d)} />
        <Stat label="AI calls · 30 days" value={fmtNum(usage.reduce((n, u) => n + u.calls, 0))} hint={`${fmtNum(usage.reduce((n, u) => n + u.tokens, 0))} tokens`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title="Team" description="People who can sign in to this workspace.">
            <ul className="mb-5 divide-y">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{m.name} <span className="ml-1 text-xs font-normal capitalize text-muted-foreground">{m.role}</span></p>
                    <p className="truncate text-xs text-muted-foreground">{m.email} · last sign-in {m.last_login_at ? fmtDate(m.last_login_at) : "never"}</p>
                  </div>
                  <RemoveMemberButton workspaceId={ws.id} userId={m.id} name={m.name} />
                </li>
              ))}
            </ul>
            <AddMemberForm workspaceId={ws.id} />
          </Panel>
          <Panel title="AI usage · 30 days" description="Runs on the tenant's own keys. Quality is the AI critic's average score (out of 10).">
            {usage.length === 0 ? <p className="text-sm text-muted-foreground">No AI activity yet.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">Feature</th><th className="pb-2 text-right font-medium">Calls</th><th className="pb-2 text-right font-medium">Errors</th><th className="pb-2 text-right font-medium">Tokens</th><th className="pb-2 text-right font-medium">Avg time</th><th className="pb-2 text-right font-medium">Quality</th></tr></thead>
                <tbody className="divide-y">{usage.map((u) => (
                  <tr key={u.feature}><td className="py-2 capitalize">{u.feature.replace("_", " ")}</td><td className="py-2 text-right tabular-nums">{u.calls}</td><td className="py-2 text-right tabular-nums">{u.errors}</td><td className="py-2 text-right tabular-nums">{fmtNum(u.tokens)}</td><td className="py-2 text-right tabular-nums">{(u.avg_ms / 1000).toFixed(1)}s</td><td className="py-2 text-right tabular-nums">{u.avg_quality ?? "—"}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Account">
            <TenantSettingsForm workspaceId={ws.id} plan={ws.plan} status={ws.status} notes={ws.notes ?? ""} />
          </Panel>
          <Panel title="Connected keys" description="Bring-your-own. Secrets are never shown here.">
            <ul className="space-y-2 text-sm">
              {ai.map((a) => (
                <li key={a.provider} className="flex items-center justify-between gap-2">
                  <span>{PROVIDERS[a.provider].label} <span className="text-xs text-muted-foreground">••••{a.key_last4}</span></span>
                  <Pill tone={a.last_ok_at ? "green" : "honey"}>{a.last_ok_at ? "verified" : "untested"}</Pill>
                </li>
              ))}
              {senders.map((s) => (
                <li key={s.from_email} className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.provider.toUpperCase()} · {s.from_email}</span>
                  <Pill tone={s.last_ok_at ? "green" : "honey"}>{s.last_ok_at ? "verified" : "untested"}</Pill>
                </li>
              ))}
              {ai.length + senders.length === 0 && <li className="text-muted-foreground">Nothing connected yet — part of onboarding.</li>}
            </ul>
          </Panel>
          <Panel title="Recent activity">
            <ul className="space-y-2 text-sm">
              {activity.map((a) => (
                <li key={a.id}><span className="font-mono text-xs">{a.action}</span> <span className="text-muted-foreground">{a.target ? `· ${a.target} ` : ""}· {a.actor ?? "system"} · {fmtDate(a.created_at)}</span></li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  )
}
