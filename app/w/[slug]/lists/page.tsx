import { requireWorkspace } from "@/lib/auth"
import { withTenant } from "@/lib/db"
import { PageHeader, Empty, fmtDate, fmtNum } from "@/components/pollen/ui"
import { CreateListForm, DeleteListButton } from "./client"

export const metadata = { title: "Lists" }

export default async function ListsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireWorkspace(slug)
  const lists = await withTenant(ctx.workspace.id, (db) =>
    db.query<{ id: string; name: string; description: string | null; created_at: string; members: number; subscribed: number }>(`
      select l.id, l.name, l.description, l.created_at,
             count(lm.contact_id)::int as members, count(lm.contact_id) filter (where c.status = 'subscribed')::int as subscribed
        from lists l left join list_members lm on lm.list_id = l.id left join contacts c on c.id = lm.contact_id
       group by l.id order by l.created_at`),
  )
  return (
    <>
      <PageHeader title="Lists" description="Hand-picked groups, like loyalty members or event sign-ups. For rule-based groups, use Segments." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {lists.length === 0 ? <Empty title="No lists yet">Create one here, then add people to it when you import a CSV.</Empty> : (
          <div className="grid content-start gap-3 sm:grid-cols-2">
            {lists.map((l) => (
              <div key={l.id} className="rounded-xl border bg-card p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{l.name}</h3>
                  <DeleteListButton slug={slug} id={l.id} name={l.name} />
                </div>
                {l.description && <p className="mt-1 text-sm text-muted-foreground">{l.description}</p>}
                <p className="mt-4 text-2xl font-semibold tabular-nums">{fmtNum(l.members)}</p>
                <p className="text-xs text-muted-foreground">{fmtNum(l.subscribed)} subscribed · created {fmtDate(l.created_at)}</p>
              </div>
            ))}
          </div>
        )}
        <CreateListForm slug={slug} />
      </div>
    </>
  )
}
