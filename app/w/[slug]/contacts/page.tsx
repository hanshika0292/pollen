import Link from "next/link"
import { requireWorkspace } from "@/lib/auth"
import { withTenant } from "@/lib/db"
import { Input } from "@/components/ui/input"
import { PageHeader, Pill, STATUS_TONE, Empty, fmtDate, fmtNum } from "@/components/pollen/ui"
import { AddContactDialog, ImportDialog, ContactRowActions } from "./client"

export const metadata = { title: "Contacts" }
const PAGE = 50

export default async function ContactsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { slug } = await params
  const sp = await searchParams
  const ctx = await requireWorkspace(slug)
  const q = (sp.q ?? "").trim()
  const status = ["subscribed", "unsubscribed", "bounced"].includes(sp.status ?? "") ? sp.status! : ""
  const page = Math.max(1, Number(sp.page) || 1)

  const { rows, total, lists, totals } = await withTenant(ctx.workspace.id, async (db) => {
    const where = `where ($1 = '' or c.email ilike '%' || $1 || '%' or coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'') ilike '%' || $1 || '%' or $1 = any(c.tags))
                     and ($2 = '' or c.status = $2)`
    const [rows, total, lists, totals] = await Promise.all([
      db.query<{ id: string; email: string; first_name: string | null; last_name: string | null; status: string; tags: string[]; source: string; created_at: string; last_engaged_at: string | null }>(
        `select id, email::text as email, first_name, last_name, status, tags, source, created_at, last_engaged_at from contacts c ${where}
          order by c.created_at desc limit ${PAGE} offset $3`, [q, status, (page - 1) * PAGE]),
      db.one<{ n: number }>(`select count(*)::int as n from contacts c ${where}`, [q, status]),
      db.query<{ id: string; name: string }>(`select id, name from lists order by name`),
      db.one<{ all: number; subscribed: number; unsubscribed: number; bounced: number }>(
        `select count(*)::int as all, count(*) filter (where status='subscribed')::int as subscribed,
                count(*) filter (where status='unsubscribed')::int as unsubscribed, count(*) filter (where status in ('bounced','complained'))::int as bounced from contacts`),
    ])
    return { rows, total: total?.n ?? 0, lists, totals: totals! }
  })
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const href = (o: Record<string, string | number>) => `?${new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) })}`

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Everyone you can reach. Imports never re-subscribe someone who opted out."
        actions={<><ImportDialog slug={slug} lists={lists} /><AddContactDialog slug={slug} /></>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5 text-sm">
          {[["", `All ${fmtNum(totals.all)}`], ["subscribed", `Subscribed ${fmtNum(totals.subscribed)}`], ["unsubscribed", `Unsubscribed ${fmtNum(totals.unsubscribed)}`], ["bounced", `Bounced ${fmtNum(totals.bounced)}`]].map(([s, label]) => (
            <Link key={s} href={`?${new URLSearchParams({ ...(q && { q }), ...(s && { status: s }) })}`} className={`rounded-full border px-3 py-1 ${status === s ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>{label}</Link>
          ))}
        </div>
        <form className="w-full sm:w-72">
          {status && <input type="hidden" name="status" value={status} />}
          <Input name="q" defaultValue={q} placeholder="Search name, email or tag…" aria-label="Search contacts" />
        </form>
      </div>
      {rows.length === 0 ? (
        <Empty title={q || status ? "No contacts match" : "No contacts yet"}>{q || status ? "Try a different search." : "Import a CSV from your POS, booking tool or spreadsheet to get started."}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3 font-medium">Contact</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Tags</th><th className="px-4 py-3 font-medium">Last engaged</th><th className="px-4 py-3 font-medium">Added</th><th className="w-10" /></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}</p>
                    <p className="text-xs text-muted-foreground">{c.email}</p>
                  </td>
                  <td className="px-4 py-2.5"><Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill></td>
                  <td className="px-4 py-2.5"><div className="flex max-w-56 flex-wrap gap-1">{c.tags.map((t) => <Pill key={t}>{t}</Pill>)}</div></td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.last_engaged_at ? fmtDate(c.last_engaged_at) : "never"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(c.created_at)} <span className="text-xs">· {c.source}</span></td>
                  <td className="px-2 py-2.5"><ContactRowActions slug={slug} id={c.id} status={c.status} email={c.email} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {pages} · {fmtNum(total)} contacts</span>
          <div className="flex gap-2">
            {page > 1 && <Link className="rounded-md border bg-card px-3 py-1.5 hover:bg-muted" href={href({ page: page - 1 })}>Previous</Link>}
            {page < pages && <Link className="rounded-md border bg-card px-3 py-1.5 hover:bg-muted" href={href({ page: page + 1 })}>Next</Link>}
          </div>
        </div>
      )}
    </>
  )
}
