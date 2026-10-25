"use client"

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, Copy, Languages, Monitor, Plus, Send, Smartphone, Sparkles, Trash2, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { aiCompose, aiRewrite, aiScore, audienceSize } from "@/lib/actions/ai"
import { deleteCampaign, duplicateCampaign, saveCampaign, sendNow, sendTestEmail, type CampaignDraft } from "@/lib/actions/campaigns"
import { BLOCK_TYPES, emptyBlock, type Block, type EmailContent } from "@/lib/email/blocks"
import { renderEmail, type Brand } from "@/lib/email/render"
import { runChecks } from "@/lib/ai/checks"
import type { Scorecard as ScorecardData } from "@/lib/ai/features"
import type { Audience } from "@/lib/tenant"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Panel } from "@/components/pollen/ui"
import { Scorecard } from "./scorecard"

type Props = {
  slug: string
  campaign: { id: string; name: string; subject: string; preview_text: string; blocks: Block[]; audience: Audience; sender_identity_id: string | null; quality: ScorecardData | null; brief: string | null }
  brand: Brand
  hasVoice: boolean
  aiReady: boolean
  userEmail: string
  isDemo: boolean
  lists: { id: string; name: string }[]
  segments: { id: string; name: string }[]
  senders: { id: string; from_name: string; from_email: string; is_default: boolean }[]
}

const GOALS = ["Announce something new", "Promote an offer", "Invite to an event", "Win back quiet customers", "Share news or tips", "Say thank you"]
const BLOCK_LABEL: Record<Block["type"], string> = { heading: "Heading", paragraph: "Paragraph", bullets: "Bullet list", cta: "Button", divider: "Divider" }
const STAGES = ["Drafting in your brand voice…", "Editor is reviewing the draft…", "Revising weak spots…", "Final quality check…"]

export function Editor(p: Props) {
  const [name, setName] = useState(p.campaign.name)
  const [content, setContent] = useState<EmailContent>({ subject: p.campaign.subject, preview_text: p.campaign.preview_text, blocks: p.campaign.blocks })
  const [audience, setAudience] = useState<Audience>(p.campaign.audience)
  const [senderId, setSenderId] = useState<string | null>(p.campaign.sender_identity_id ?? p.senders.find((s) => s.is_default)?.id ?? null)
  const [score, setScore] = useState<ScorecardData | null>(p.campaign.quality)
  const [goal, setGoal] = useState(GOALS[0])
  const [brief, setBrief] = useState(p.campaign.brief ?? "")
  const [ctaUrl, setCtaUrl] = useState(p.brand.website ?? "")
  const [length, setLength] = useState<"short" | "medium" | "long">("short")
  const [stage, setStage] = useState(0)
  const [aiPending, startAi] = useTransition()
  const [busy, startBusy] = useTransition()
  const [saved, setSaved] = useState<"saved" | "saving" | "dirty">("saved")
  const [count, setCount] = useState<number | null>(null)
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop")
  const [testTo, setTestTo] = useState(p.userEmail)
  const [stale, setStale] = useState(false)
  const first = useRef(true)

  const draft = (): CampaignDraft => ({ name, subject: content.subject, preview_text: content.preview_text, blocks: content.blocks, audience, sender_identity_id: senderId })

  // Autosave
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setSaved("dirty")
    setStale(true)
    const t = setTimeout(async () => {
      setSaved("saving")
      const r = await saveCampaign(p.slug, p.campaign.id, draft())
      setSaved(r.ok ? "saved" : "dirty")
      if (!r.ok) toast.error(r.error)
    }, 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, content, audience, senderId])

  useEffect(() => {
    let live = true
    audienceSize(p.slug, audience).then((n) => live && setCount(n))
    return () => { live = false }
  }, [audience, p.slug])

  useEffect(() => {
    if (!aiPending) return setStage(0)
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 7000)
    return () => clearInterval(t)
  }, [aiPending])

  // Preview + checks lag typing slightly so the editor itself never stutters.
  const deferred = useDeferredValue(content)
  const checks = useMemo(() => runChecks(deferred, { hasAddress: !!p.brand.address }), [deferred, p.brand.address])
  const html = useMemo(() => renderEmail({ blocks: deferred.blocks, previewText: deferred.preview_text, brand: p.brand, recipient: { email: p.userEmail, first_name: null }, unsubscribeUrl: "#" }), [deferred, p.brand, p.userEmail])

  const setBlock = (i: number, patch: Partial<Block>) => setContent((c) => ({ ...c, blocks: c.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) }))
  const move = (i: number, d: -1 | 1) => setContent((c) => {
    const blocks = [...c.blocks]
    const j = i + d
    if (j < 0 || j >= blocks.length) return c
    ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
    return { ...c, blocks }
  })

  function compose() {
    startAi(async () => {
      const r = await aiCompose(p.slug, p.campaign.id, { goal, brief, ctaUrl, length })
      if (!r.ok) return void toast.error(r.error)
      first.current = true // server already saved the AI draft
      setContent(r.content)
      setScore(r.scorecard)
      setStale(false)
      toast.success(`Draft ready · quality ${r.scorecard.overall}/10${r.scorecard.passes > 1 ? " after one revision" : ""}`)
    })
  }

  function rewrite(kind: Parameters<typeof aiRewrite>[2], label: string) {
    startAi(async () => {
      const r = await aiRewrite(p.slug, content, kind)
      if (!r.ok) return void toast.error(r.error)
      setContent(r.content)
      toast.success(`${label} — re-score when you're happy`)
    })
  }

  function rescore() {
    startAi(async () => {
      await saveCampaign(p.slug, p.campaign.id, draft())
      const r = await aiScore(p.slug, p.campaign.id, content, goal)
      if (!r.ok) return void toast.error(r.error)
      setScore(r.scorecard)
      setStale(false)
    })
  }

  function test() {
    startBusy(async () => {
      await saveCampaign(p.slug, p.campaign.id, draft())
      const r = await sendTestEmail(p.slug, p.campaign.id, testTo)
      if (r.ok) toast.success(`Test sent to ${testTo}`)
      else toast.error(r.error)
    })
  }

  function send() {
    const errors = checks.filter((c) => c.level === "error")
    if (errors.length) return void toast.error(errors[0].message)
    if (!confirm(`Send "${content.subject}" to ${count?.toLocaleString("en-IN") ?? "your audience"} people now? This can't be undone.`)) return
    startBusy(async () => {
      const s = await saveCampaign(p.slug, p.campaign.id, draft())
      if (!s.ok) return void toast.error(s.error)
      const r = await sendNow(p.slug, p.campaign.id)
      if (r.ok) toast.success(r.message)
      else toast.error(r.error)
    })
  }

  const aiDisabled = !p.aiReady || aiPending

  return (
    <>
      <div className="mb-2 text-sm"><Link href={`/w/${p.slug}/campaigns`} className="text-muted-foreground hover:text-foreground">← Campaigns</Link></div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Campaign name"
            className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-2xl font-semibold tracking-tight outline-none hover:bg-muted/60 focus:bg-card focus:ring-2 focus:ring-ring/30" />
          <span className="shrink-0 text-xs text-muted-foreground">{saved === "saved" ? "Saved" : saved === "saving" ? "Saving…" : "Unsaved"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={duplicateCampaign.bind(null, p.slug, p.campaign.id)}><Button variant="ghost" size="sm" type="submit"><Copy /> Duplicate</Button></form>
          <form action={deleteCampaign.bind(null, p.slug, p.campaign.id)} onSubmit={(e) => { if (!confirm("Delete this draft?")) e.preventDefault() }}><Button variant="ghost" size="sm" type="submit"><Trash2 /> Delete</Button></form>
          <Button onClick={send} disabled={busy || p.isDemo || !senderId} title={p.isDemo ? "Sending is disabled in the demo workspace" : !senderId ? "Connect a sender in Settings" : undefined}>
            <Send /> {busy ? "Working…" : "Send campaign"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Write with AI" description={p.hasVoice ? "Uses your brand voice, then an AI editor scores and revises it before you see it." : "Tip: set up your brand voice in Brand kit for on-brand drafts."}>
            {!p.aiReady ? (
              <p className="text-sm text-muted-foreground">Connect your OpenAI, Anthropic or Gemini key in <Link href={`/w/${p.slug}/settings`} className="text-primary hover:underline">Settings</Link> to write with AI. You can still write by hand below.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {GOALS.map((g) => (
                    <button key={g} onClick={() => setGoal(g)} className={`rounded-full border px-3 py-1 text-xs ${goal === g ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>{g}</button>
                  ))}
                </div>
                <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} aria-label="Brief"
                  placeholder="What's this email about? Include the facts: what, when, where, any offer. e.g. New shakshuka + sourdough brunch plate, this weekend 9am–1pm, no discount." />
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                  <Input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="Button link (https://…)" aria-label="Button link" />
                  <div className="flex rounded-md border p-0.5 text-xs">
                    {(["short", "medium", "long"] as const).map((l) => (
                      <button key={l} onClick={() => setLength(l)} className={`rounded px-2.5 capitalize ${length === l ? "bg-secondary font-medium" : "text-muted-foreground"}`}>{l}</button>
                    ))}
                  </div>
                  <Button onClick={compose} disabled={aiDisabled || brief.trim().length < 10}><Sparkles /> {content.blocks.length ? "Rewrite draft" : "Write draft"}</Button>
                </div>
                {aiPending && (
                  <div className="flex items-center gap-3 rounded-lg bg-honey/15 px-3 py-2.5 text-sm text-honey-foreground">
                    <span className="size-3 animate-ping rounded-full bg-honey" /> {STAGES[stage]}
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Email">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" value={content.subject} onChange={(e) => setContent({ ...content, subject: e.target.value })} />
                {score?.subject_options && score.subject_options.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {score.subject_options.map((s) => (
                      <button key={s.text} onClick={() => setContent({ ...content, subject: s.text })}
                        className={`rounded-md border px-2 py-1 text-left text-xs ${content.subject === s.text ? "border-primary bg-primary/5" : "hover:bg-muted"}`}>
                        {s.text} <span className="text-muted-foreground">· {s.angle}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="preview">Preview text</Label>
                <Input id="preview" value={content.preview_text} onChange={(e) => setContent({ ...content, preview_text: e.target.value })} placeholder="Shown next to the subject in the inbox" />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Body</Label>
                  <span className="text-xs text-muted-foreground">Personalise with {"{{first_name|there}}"} · **bold** · [link](https://…)</span>
                </div>
                {content.blocks.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Empty. Write with AI above, or add blocks below.</p>}
                {content.blocks.map((b, i) => (
                  <div key={i} className="group rounded-lg border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{BLOCK_LABEL[b.type]}</span>
                      <div className="flex gap-0.5">
                        <IconBtn label="Move up" onClick={() => move(i, -1)}><ArrowUp /></IconBtn>
                        <IconBtn label="Move down" onClick={() => move(i, 1)}><ArrowDown /></IconBtn>
                        <IconBtn label="Remove block" onClick={() => setContent({ ...content, blocks: content.blocks.filter((_, j) => j !== i) })}><Trash2 /></IconBtn>
                      </div>
                    </div>
                    {b.type === "heading" && <Input value={b.text} onChange={(e) => setBlock(i, { text: e.target.value })} className="font-semibold" aria-label="Heading" />}
                    {b.type === "paragraph" && <Textarea value={b.text} onChange={(e) => setBlock(i, { text: e.target.value })} rows={Math.min(8, Math.max(2, Math.ceil(b.text.length / 80)))} aria-label="Paragraph" />}
                    {b.type === "bullets" && <Textarea value={b.items.join("\n")} onChange={(e) => setBlock(i, { items: e.target.value.split("\n") })} rows={Math.max(2, b.items.length)} placeholder="One point per line" aria-label="Bullet points" />}
                    {b.type === "cta" && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input value={b.text} onChange={(e) => setBlock(i, { text: e.target.value })} placeholder="Button label" aria-label="Button label" />
                        <Input value={b.url} onChange={(e) => setBlock(i, { url: e.target.value })} placeholder="https://" aria-label="Button link" />
                      </div>
                    )}
                    {b.type === "divider" && <hr className="my-2" />}
                  </div>
                ))}
                <div className="flex flex-wrap gap-1.5">
                  {BLOCK_TYPES.map((t) => (
                    <Button key={t} variant="outline" size="sm" onClick={() => setContent({ ...content, blocks: [...content.blocks, emptyBlock(t)] })}><Plus /> {BLOCK_LABEL[t]}</Button>
                  ))}
                </div>
              </div>

              {p.aiReady && content.blocks.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-t pt-4">
                  <span className="mr-1 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Wand2 className="size-3.5" /> Quick rewrite</span>
                  {([["shorter", "Shorter"], ["friendlier", "Friendlier"], ["punchier", "Punchier"], ["professional", "More polished"]] as const).map(([k, l]) => (
                    <Button key={k} variant="secondary" size="sm" disabled={aiDisabled} onClick={() => rewrite(k, l)}>{l}</Button>
                  ))}
                  <Button variant="secondary" size="sm" disabled={aiDisabled} onClick={() => rewrite("hindi", "Translated to Hindi")}><Languages /> Hindi</Button>
                  <Button variant="secondary" size="sm" disabled={aiDisabled} onClick={() => rewrite("hinglish", "Rewritten in Hinglish")}>Hinglish</Button>
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Scorecard score={score} checks={checks} stale={stale && !!score} onRescore={p.aiReady && content.blocks.length ? rescore : undefined} pending={aiPending} />

          <Panel title="Audience & sender">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="audience">Send to</Label>
                <select id="audience" className="h-9 w-full rounded-md border bg-card px-3 text-sm"
                  value={audience.type === "all" ? "all" : `${audience.type}:${audience.id}`}
                  onChange={(e) => { const [type, id] = e.target.value.split(":"); setAudience(type === "all" ? { type: "all" } : { type: type as "list" | "segment", id }) }}>
                  <option value="all">All subscribed contacts</option>
                  {p.lists.length > 0 && <optgroup label="Lists">{p.lists.map((l) => <option key={l.id} value={`list:${l.id}`}>{l.name}</option>)}</optgroup>}
                  {p.segments.length > 0 && <optgroup label="Segments">{p.segments.map((s) => <option key={s.id} value={`segment:${s.id}`}>{s.name}</option>)}</optgroup>}
                </select>
                <p className="text-xs text-muted-foreground">{count === null ? "Counting…" : `${count.toLocaleString("en-IN")} subscribed people will receive this.`}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sender">From</Label>
                {p.senders.length ? (
                  <select id="sender" className="h-9 w-full rounded-md border bg-card px-3 text-sm" value={senderId ?? ""} onChange={(e) => setSenderId(e.target.value || null)}>
                    {p.senders.map((s) => <option key={s.id} value={s.id}>{s.from_name} &lt;{s.from_email}&gt;</option>)}
                  </select>
                ) : <p className="text-sm text-muted-foreground">No sender yet — <Link href={`/w/${p.slug}/settings`} className="text-primary hover:underline">connect SES or SMTP</Link>.</p>}
              </div>
              <div className="flex gap-2 border-t pt-3">
                <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Test email address" />
                <Button variant="outline" onClick={test} disabled={busy || !senderId}>Send test</Button>
              </div>
            </div>
          </Panel>

          <Panel title="Preview" actions={
            <div className="flex rounded-md border p-0.5">
              <IconBtn label="Desktop preview" active={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor /></IconBtn>
              <IconBtn label="Mobile preview" active={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone /></IconBtn>
            </div>
          }>
            <div className="-m-2 rounded-lg bg-muted/50 p-2">
              <div className="mb-2 rounded-md bg-card px-3 py-2 text-xs">
                <p className="truncate font-semibold">{content.subject || "(no subject)"}</p>
                <p className="truncate text-muted-foreground">{content.preview_text}</p>
              </div>
              <iframe title="Email preview" srcDoc={html} sandbox="" className={`mx-auto block h-[560px] rounded-md border bg-white ${device === "mobile" ? "w-[340px]" : "w-full"}`} />
            </div>
          </Panel>
        </div>
      </div>
    </>
  )
}

function IconBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={`rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5 ${active ? "bg-secondary text-foreground" : ""}`}>
      {children}
    </button>
  )
}
