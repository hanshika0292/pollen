import { canManage, requireWorkspace } from "@/lib/auth"
import { withGlobal, withTenant } from "@/lib/db"
import { PROVIDERS, type Provider } from "@/lib/ai/core"
import { PageHeader, Panel, Pill, fmtDate } from "@/components/pollen/ui"
import { AiKeyForm, AiKeyRow, SenderForm, SenderRow, TeamForm } from "./client"

export const metadata = { title: "Settings" }

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireWorkspace(slug)
  const manage = canManage(ctx)
  const [{ keys, senders, usage }, members] = await Promise.all([
    withTenant(ctx.workspace.id, async (db) => ({
      keys: await db.query<{ provider: Provider; key_last4: string; quality_model: string; fast_model: string; is_default: boolean; last_ok_at: string | null }>(
        `select provider, key_last4, quality_model, fast_model, is_default, last_ok_at from ai_credentials order by is_default desc, created_at`),
      senders: await db.query<{ id: string; provider: string; from_name: string; from_email: string; reply_to: string | null; is_default: boolean; last_ok_at: string | null }>(
        `select id, provider, from_name, from_email::text as from_email, reply_to::text as reply_to, is_default, last_ok_at from sender_identities order by is_default desc, created_at`),
      usage: await db.one<{ calls: number; tokens: number; errors: number }>(
        `select count(*)::int as calls, coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0)::int as tokens, count(*) filter (where status='error')::int as errors
           from ai_runs where created_at > now() - interval '30 days'`),
    })),
    withGlobal((db) => db.query<{ name: string; email: string; role: string; last_login_at: string | null }>(
      `select u.name, u.email::text as email, m.role, u.last_login_at from memberships m join users u on u.id = m.user_id where m.workspace_id = $1 order by m.created_at`, [ctx.workspace.id])),
  ])

  return (
    <>
      <PageHeader title="Settings" description="Your own AI and email accounts — Pollen never marks up usage, you pay providers directly." />
      <div className="space-y-6">
        <Panel title="AI provider" description={`Pollen writes with your key. Add a second provider and Pollen fails over to it automatically. Last 30 days: ${usage!.calls} calls · ${usage!.tokens.toLocaleString("en-IN")} tokens${usage!.errors ? ` · ${usage!.errors} errors` : ""}.`}>
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-2">
              {keys.length === 0 && <p className="text-sm text-muted-foreground">No provider connected yet.</p>}
              {keys.map((k) => <AiKeyRow key={k.provider} slug={slug} manage={manage} k={{ ...k, label: PROVIDERS[k.provider].label }} />)}
            </div>
            {manage && <AiKeyForm slug={slug} />}
          </div>
        </Panel>

        <Panel title="Email sending" description="Send from your own domain through Amazon SES or any SMTP service (Google Workspace, Zoho, Brevo, Postmark…).">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-2">
              {senders.length === 0 && <p className="text-sm text-muted-foreground">No sender connected yet.</p>}
              {senders.map((s) => <SenderRow key={s.id} slug={slug} manage={manage} s={s} />)}
            </div>
            {manage && <SenderForm slug={slug} />}
          </div>
        </Panel>

        <Panel title="Team">
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <ul className="divide-y text-sm">
              {members.map((m) => (
                <li key={m.email} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0"><p className="font-medium">{m.name}</p><p className="truncate text-xs text-muted-foreground">{m.email} · last sign-in {m.last_login_at ? fmtDate(m.last_login_at) : "never"}</p></div>
                  <Pill>{m.role}</Pill>
                </li>
              ))}
            </ul>
            {manage && <TeamForm slug={slug} />}
          </div>
        </Panel>
      </div>
    </>
  )
}
