"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { Plus, Sparkles, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { aiSegment, deleteSegment, previewSegment, saveSegment } from "@/lib/actions/ai"
import { FIELDS, type Field, type Rules } from "@/lib/segments"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Panel } from "@/components/pollen/ui"

const EXAMPLES = [
  "Regulars who haven't opened anything in 2 months",
  "Coffee Club members who clicked an email recently",
  "People who joined in the last 30 days",
]

const OP_LABEL: Record<string, string> = {
  is: "is", is_not: "is not", has: "has", not_has: "doesn't have", contains: "contains", exists: "is set", in: "in", not_in: "not in",
  within: "within last (days)", older_than: "more than (days) ago", never: "never", yes: "yes, within (days)", no: "no, not within (days)",
}
const sel = "h-9 rounded-md border bg-card px-2 text-sm"

export function SegmentBuilder({ slug, lists, aiReady }: { slug: string; lists: { id: string; name: string }[]; aiReady: boolean }) {
  const [request, setRequest] = useState("")
  const [rules, setRules] = useState<Rules>({ match: "all", conditions: [{ field: "status", op: "is", value: "subscribed" }] })
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [assumptions, setAssumptions] = useState<string[]>([])
  const [preview, setPreview] = useState<{ count: number; sample: { email: string; first_name: string | null }[] } | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [aiPending, startAi] = useTransition()
  const [savePending, startSave] = useTransition()
  const [fromAi, setFromAi] = useState<string | undefined>()

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await previewSegment(slug, rules)
      if (r.ok) { setPreview(r); setPreviewError("") } else { setPreview(null); setPreviewError(r.error) }
    }, 350)
    return () => clearTimeout(t)
  }, [rules, slug])

  function ask(text = request) {
    if (!text.trim()) return
    setRequest(text)
    startAi(async () => {
      const r = await aiSegment(slug, text)
      if (!r.ok) return void toast.error(r.error)
      setRules(r.rules)
      setName(r.name)
      setDescription(r.description)
      setAssumptions(r.assumptions)
      setFromAi(text)
    })
  }

  const update = (i: number, patch: Partial<Rules["conditions"][number]>) =>
    setRules((r) => ({ ...r, conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <Panel title="Build an audience" description="Describe who you want to reach in plain words, or edit the rules directly.">
        <div className="space-y-3">
          <div className="relative">
            <Textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask() }}
              rows={2}
              placeholder={aiReady ? "e.g. brunch regulars who haven't visited our emails in a while" : "Connect an AI key in Settings to describe audiences in plain words."}
              disabled={!aiReady}
              className="pr-28"
            />
            <Button size="sm" className="absolute bottom-2 right-2" onClick={() => ask()} disabled={!aiReady || aiPending || !request.trim()}>
              <Sparkles /> {aiPending ? "Thinking…" : "Build"}
            </Button>
          </div>
          {aiReady ? (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((e) => <button key={e} onClick={() => ask(e)} disabled={aiPending} className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs hover:bg-muted">{e}</button>)}
            </div>
          ) : <Link href={`/w/${slug}/settings`} className="text-sm text-primary hover:underline">Connect an AI provider →</Link>}

          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm">
              Match
              <select value={rules.match} onChange={(e) => setRules({ ...rules, match: e.target.value as "all" | "any" })} className={sel} aria-label="Match mode">
                <option value="all">all</option><option value="any">any</option>
              </select>
              of these rules
            </div>
            <div className="space-y-2">
              {rules.conditions.map((c, i) => {
                const spec = FIELDS[c.field]
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select value={c.field} className={sel} aria-label="Field"
                      onChange={(e) => { const f = e.target.value as Field; update(i, { field: f, op: FIELDS[f].ops[0], value: FIELDS[f].value === "number" ? "30" : FIELDS[f].value.startsWith("enum:") ? FIELDS[f].value.slice(5).split(",")[0] : "" }) }}>
                      {Object.entries(FIELDS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                    </select>
                    <select value={c.op} onChange={(e) => update(i, { op: e.target.value })} className={sel} aria-label="Operator">
                      {spec.ops.map((o) => <option key={o} value={o}>{OP_LABEL[o] ?? o}</option>)}
                    </select>
                    {c.op !== "never" && (spec.value.startsWith("enum:") ? (
                      <select value={c.value} onChange={(e) => update(i, { value: e.target.value })} className={sel} aria-label="Value">
                        {spec.value.slice(5).split(",").map((v) => <option key={v}>{v}</option>)}
                      </select>
                    ) : spec.value === "list_id" ? (
                      <select value={c.value} onChange={(e) => update(i, { value: e.target.value })} className={sel} aria-label="List">
                        <option value="">Choose a list</option>
                        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    ) : (
                      <Input value={c.value} onChange={(e) => update(i, { value: e.target.value })} className="h-9 w-40" aria-label="Value"
                        placeholder={spec.value === "key=value" ? "city=Bengaluru" : spec.value === "number" ? "days" : "value"} />
                    ))}
                    <button onClick={() => setRules({ ...rules, conditions: rules.conditions.filter((_, j) => j !== i) })} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Remove rule"><X className="size-4" /></button>
                  </div>
                )
              })}
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setRules({ ...rules, conditions: [...rules.conditions, { field: "tag", op: "has", value: "" }] })}>
              <Plus /> Add rule
            </Button>
          </div>
          {assumptions.length > 0 && (
            <div className="rounded-lg border border-honey/40 bg-honey/10 p-3 text-sm">
              <p className="mb-1 font-medium text-honey-foreground">Check these assumptions</p>
              <ul className="list-disc space-y-0.5 pl-5 text-honey-foreground/90">{assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Who's in it">
        <div className="space-y-4">
          {previewError ? <p className="text-sm text-destructive">{previewError}</p> : (
            <>
              <p><span className="text-3xl font-semibold tabular-nums">{preview?.count.toLocaleString("en-IN") ?? "…"}</span> <span className="text-muted-foreground">people match</span></p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {preview?.sample.map((s) => <li key={s.email} className="truncate">{s.first_name ? `${s.first_name} · ` : ""}{s.email}</li>)}
              </ul>
            </>
          )}
          <div className="space-y-2 border-t pt-4">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Segment name" aria-label="Segment name" />
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" aria-label="Description" />
            <Button className="w-full" disabled={savePending || !name.trim() || !!previewError}
              onClick={() => startSave(async () => {
                const r = await saveSegment(slug, { name, description, rules, aiPrompt: fromAi })
                if (!r.ok) return void toast.error(r.error)
                toast.success(`Saved "${name}"`)
                setName(""); setDescription(""); setAssumptions([]); setRequest(""); setFromAi(undefined)
              })}>
              Save segment
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  )
}

export function DeleteSegmentButton({ slug, id, name }: { slug: string; id: string; name: string }) {
  const [pending, start] = useTransition()
  return (
    <button disabled={pending} aria-label={`Delete ${name}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
      onClick={() => { if (confirm(`Delete the segment "${name}"?`)) start(() => deleteSegment(slug, id)) }}>
      <Trash2 className="size-4" />
    </button>
  )
}
