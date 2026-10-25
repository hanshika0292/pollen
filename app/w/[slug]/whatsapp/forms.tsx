"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { Megaphone, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { fetchTemplates, sendWaBroadcast, setAutoReply, type Result } from "@/lib/actions/whatsapp"
import type { WaTemplate } from "@/lib/whatsapp/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Panel, Pill } from "@/components/pollen/ui"

const MERGE = ["first_name", "last_name", "email"]
const sel = "h-9 w-full rounded-md border bg-card px-3 text-sm"

export function AutoReplyForm({ slug, initial, aiReady }: { slug: string; initial: { mode: string; text?: string }; aiReady: boolean }) {
  const [state, action, pending] = useActionState<Result, FormData>(setAutoReply.bind(null, slug), {})
  const [mode, setMode] = useState(initial.mode ?? "off")
  useEffect(() => { if (state.ok) toast.success(state.message) }, [state])
  return (
    <Panel title="Auto-reply" description="Automatically respond to inbound messages. Only fires inside the 24-hour window.">
      <form action={action} className="space-y-4">
        <div className="space-y-2">
          {[
            ["off", "Off", "Don't send any automatic reply."],
            ["away", "Away message", "Send the same fixed message to every first inbound message."],
            ["ai", "AI reply", "Draft an on-brand reply to each message with AI and send it automatically."],
          ].map(([val, label, desc]) => (
            <label key={val} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${mode === val ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
              <input type="radio" name="mode" value={val} checked={mode === val} onChange={() => setMode(val)} className="mt-0.5" disabled={val === "ai" && !aiReady} />
              <div><p className="text-sm font-medium">{label}{val === "ai" && !aiReady && <span className="ml-2 text-xs font-normal text-muted-foreground">(connect an AI key first)</span>}</p><p className="text-xs text-muted-foreground">{desc}</p></div>
            </label>
          ))}
        </div>
        {mode === "away" && <Textarea name="text" defaultValue={initial.text} rows={3} placeholder="Thanks for messaging! We'll reply within a few hours. Our hours are 9am–7pm." required />}
        {mode === "ai" && <p className="rounded-md bg-honey/10 px-3 py-2 text-xs text-honey-foreground">AI replies use your brand voice. It won't invent prices or facts — it'll say it will check instead.</p>}
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save auto-reply"}</Button>
      </form>
    </Panel>
  )
}

export function BroadcastComposer({ slug, lists, segments, phoneCount, isDemo, hasWaba }: {
  slug: string; lists: { id: string; name: string }[]; segments: { id: string; name: string }[]; phoneCount: number; isDemo: boolean; hasWaba: boolean
}) {
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null)
  const [loadErr, setLoadErr] = useState("")
  const [loading, startLoad] = useTransition()
  const [sending, startSend] = useTransition()
  const [name, setName] = useState("")
  const [selected, setSelected] = useState<WaTemplate | null>(null)
  const [audience, setAudience] = useState<{ type: "all" } | { type: "list" | "segment"; id: string }>({ type: "all" })
  const [vars, setVars] = useState<{ kind: "merge" | "literal"; value: string }[]>([])

  function load() {
    startLoad(async () => {
      const r = await fetchTemplates(slug)
      if (!r.ok) return setLoadErr(r.error)
      setLoadErr("")
      setTemplates(r.templates)
    })
  }
  useEffect(() => { if (selected) setVars(Array.from({ length: selected.variableCount }, () => ({ kind: "merge" as const, value: "first_name" }))) }, [selected])

  function send() {
    if (!selected || !name.trim()) return void toast.error("Name the broadcast and pick a template.")
    startSend(async () => {
      const r = await sendWaBroadcast(slug, { name, template_name: selected.name, language: selected.language, variables: vars, audience })
      if (!r.ok) return void toast.error(r.error)
      toast.success(r.message)
      setName(""); setSelected(null)
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Panel title="Template broadcast" description="WhatsApp requires a pre-approved template to message people outside an open conversation.">
        {!hasWaba ? (
          <p className="text-sm text-muted-foreground">Add your WABA ID in the connection settings to load templates.</p>
        ) : templates === null ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Load your approved templates from Meta to start a broadcast.</p>
            <Button onClick={load} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> {loading ? "Loading…" : "Load templates"}</Button>
            {loadErr && <p className="text-sm text-destructive">{loadErr}</p>}
          </div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved templates found. Create and get one approved in Meta first.</p>
        ) : (
          <div className="space-y-4">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Broadcast name (internal)" />
            <div className="space-y-1.5">
              <Label>Template</Label>
              <div className="max-h-52 space-y-1.5 overflow-y-auto">
                {templates.map((t) => (
                  <button key={t.name + t.language} onClick={() => setSelected(t)} className={`w-full rounded-lg border p-3 text-left text-sm ${selected?.name === t.name ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
                    <div className="flex items-center justify-between"><span className="font-medium">{t.name}</span><Pill>{t.language}</Pill></div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.bodyText}</p>
                  </button>
                ))}
              </div>
            </div>
            {selected && vars.length > 0 && (
              <div className="space-y-2">
                <Label>Fill the template variables</Label>
                {vars.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-10 text-sm text-muted-foreground">{`{{${i + 1}}}`}</span>
                    <select value={v.kind} onChange={(e) => setVars(vars.map((x, j) => j === i ? { ...x, kind: e.target.value as "merge" | "literal", value: e.target.value === "merge" ? "first_name" : "" } : x))} className={sel + " w-28"}>
                      <option value="merge">Contact field</option><option value="literal">Fixed text</option>
                    </select>
                    {v.kind === "merge" ? (
                      <select value={v.value} onChange={(e) => setVars(vars.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} className={sel}>{MERGE.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                    ) : (
                      <Input value={v.value} onChange={(e) => setVars(vars.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="e.g. Diwali" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>
      <Panel title="Audience & send">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wa-audience">Send to</Label>
            <select id="wa-audience" className={sel} value={audience.type === "all" ? "all" : `${audience.type}:${audience.id}`}
              onChange={(e) => { const [type, id] = e.target.value.split(":"); setAudience(type === "all" ? { type: "all" } : { type: type as "list" | "segment", id }) }}>
              <option value="all">All subscribed contacts with a phone</option>
              {lists.length > 0 && <optgroup label="Lists">{lists.map((l) => <option key={l.id} value={`list:${l.id}`}>{l.name}</option>)}</optgroup>}
              {segments.length > 0 && <optgroup label="Segments">{segments.map((s) => <option key={s.id} value={`segment:${s.id}`}>{s.name}</option>)}</optgroup>}
            </select>
            <p className="text-xs text-muted-foreground">{phoneCount} subscribed contacts have a phone number. Only they can receive WhatsApp.</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            Only message people who opted in to WhatsApp from you. Template category and Meta&apos;s per-message pricing apply.
          </div>
          <Button onClick={send} disabled={sending || isDemo || !selected} className="w-full" title={isDemo ? "Disabled in the demo workspace" : undefined}>
            <Megaphone /> {sending ? "Sending…" : "Send broadcast"}
          </Button>
          {isDemo && <p className="text-center text-xs text-muted-foreground">Sending is disabled in the demo workspace.</p>}
        </div>
      </Panel>
    </div>
  )
}
