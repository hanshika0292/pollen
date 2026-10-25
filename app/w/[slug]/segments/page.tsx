import { requireWorkspace } from "@/lib/auth"
import { withTenant } from "@/lib/db"
import { hasAi } from "@/lib/ai/core"
import { compileRules, describeCondition, rulesSchema } from "@/lib/segments"
import { PageHeader, Empty, fmtNum } from "@/components/pollen/ui"
import { SegmentBuilder, DeleteSegmentButton } from "./client"

export const metadata = { title: "Segments" }

export default async function SegmentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireWorkspace(slug)
  const { segments, lists } = await withTenant(ctx.workspace.id, async (db) => {
    const lists = await db.query<{ id: string; name: string }>(`select id, name from lists order by name`)
    const rows = await db.query<{ id: string; name: string; description: string | null; rules: unknown; ai_prompt: string | null }>(`select id, name, description, rules, ai_prompt from segments order by created_at`)
    const segments = await Promise.all(rows.map(async (s) => {
      const rules = rulesSchema.parse(s.rules)
      const { sql, params } = compileRules(rules)
      const n = (await db.one<{ n: number }>(`select count(*)::int as n from contacts c where ${sql}`, params))?.n ?? 0
      return { ...s, rules, count: n }
    }))
    return { segments, lists }
  })
  const listNames = Object.fromEntries(lists.map((l) => [l.id, l.name]))
  const aiReady = await hasAi(ctx.workspace.id)

  return (
    <>
      <PageHeader title="Segments" description="Live, rule-based audiences. They update automatically as contacts engage." />
      <SegmentBuilder slug={slug} lists={lists} aiReady={aiReady} />
      <h2 className="mb-3 mt-8 font-semibold">Saved segments</h2>
      {segments.length === 0 ? <Empty title="No segments yet">Describe an audience above and save it.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {segments.map((s) => (
            <div key={s.id} className="rounded-xl border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{s.name}</h3>
                  {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                </div>
                <div className="flex items-start gap-2">
                  <div className="text-right"><p className="text-xl font-semibold tabular-nums">{fmtNum(s.count)}</p><p className="text-xs text-muted-foreground">people now</p></div>
                  <DeleteSegmentButton slug={slug} id={s.id} name={s.name} />
                </div>
              </div>
              <ul className="mt-3 space-y-1 text-sm">
                {s.rules.conditions.map((c, i) => (
                  <li key={i} className="flex gap-2"><span className="w-8 shrink-0 text-xs uppercase text-muted-foreground">{i === 0 ? "who" : s.rules.match === "all" ? "and" : "or"}</span>{describeCondition(c, listNames)}</li>
                ))}
              </ul>
              {s.ai_prompt && <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">Built from: “{s.ai_prompt}”</p>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
