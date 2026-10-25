import Link from "next/link"
import { Plus } from "lucide-react"
import { withAdmin } from "@/lib/db"
import { Button } from "@/components/ui/button"
import { PageHeader, Stat, Pill, STATUS_TONE, fmtDate, fmtNum } from "@/components/pollen/ui"

export const metadata = { title: "Tenants" }

type Row = {
  id: string; slug: string; name: string; industry: string | null; plan: string; status: string; is_demo: boolean; created_at: string
  members: number; contacts: number; emails_30d: number; ai_runs_30d: number; ai_tokens_30d: number; ai_ready: boolean; sender_ready: boolean
}

export default async function AdminHome() {
  const rows = await withAdmin((db) =>
    db.query<Row>(`
      select w.id, w.slug, w.name, w.industry, w.plan, w.status, w.is_demo, w.created_at,
        (select count(*) from memberships m where m.workspace_id = w.id)::int as members,
        (select count(*) from contacts c where c.workspace_id = w.id)::int as contacts,
        (select count(*) from email_events e where e.workspace_id = w.id and e.type = 'sent' and e.occurred_at > now() - interval '30 days')::int as emails_30d,
        (select count(*) from ai_runs r where r.workspace_id = w.id and r.created_at > now() - interval '30 days')::int as ai_runs_30d,
        (select coalesce(sum(coalesce(input_tokens,0) + coalesce(output_tokens,0)),0) from ai_runs r where r.workspace_id = w.id and r.created_at > now() - interval '30 days')::int as ai_tokens_30d,
        exists (select 1 from ai_credentials a where a.workspace_id = w.id) as ai_ready,
        exists (select 1 from sender_identities s where s.workspace_id = w.id) as sender_ready
      from workspaces w order by w.created_at desc`),
  )
  const sum = (k: keyof Row) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0)

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Every business on Pollen. Workspaces are created here during sales-led onboarding."
        actions={<Button asChild><Link href="/admin/tenants/new"><Plus /> New tenant</Link></Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active tenants" value={rows.filter((r) => r.status === "active").length} hint={`${rows.length} total`} />
        <Stat label="Contacts under management" value={fmtNum(sum("contacts"))} />
        <Stat label="Emails sent · 30 days" value={fmtNum(sum("emails_30d"))} />
        <Stat label="AI calls · 30 days" value={fmtNum(sum("ai_runs_30d"))} hint={`${fmtNum(sum("ai_tokens_30d"))} tokens on tenants' own keys`} />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Setup</th>
              <th className="px-4 py-3 text-right font-medium">Contacts</th>
              <th className="px-4 py-3 text-right font-medium">Sent · 30d</th>
              <th className="px-4 py-3 text-right font-medium">AI · 30d</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link href={`/admin/tenants/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    /{r.slug}{r.industry && <> · {r.industry}</>}
                    {r.is_demo && <Pill tone="honey">demo</Pill>}
                    {r.status !== "active" && <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>}
                  </div>
                </td>
                <td className="px-4 py-3 capitalize">{r.plan}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5">
                    <Pill tone={r.ai_ready ? "green" : "gray"}>AI key</Pill>
                    <Pill tone={r.sender_ready ? "green" : "gray"}>Sender</Pill>
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtNum(r.contacts)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtNum(r.emails_30d)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtNum(r.ai_runs_30d)}</td>
                <td className="px-4 py-3 text-muted-foreground">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
