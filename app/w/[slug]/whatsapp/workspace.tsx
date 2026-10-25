"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Check, CheckCheck, Copy, Send, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { loadThread, sendReply, suggestReply, type ThreadMessage } from "@/lib/actions/whatsapp"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Panel, Pill, Empty } from "@/components/pollen/ui"
import { cn } from "@/lib/utils"
import { AutoReplyForm, BroadcastComposer } from "./forms"

type Convo = { id: string; wa_phone: string; name: string | null; last_message_at: string | null; last_inbound_at: string | null; unread: number; last_body: string | null }

export function WhatsAppWorkspace(props: {
  slug: string
  creds: { display_phone: string | null; waba_id: string | null; verify_token: string; auto_reply: { mode: string; text?: string }; last_ok_at: string | null }
  webhookUrl: string
  conversations: Convo[]
  lists: { id: string; name: string }[]
  segments: { id: string; name: string }[]
  phoneCount: number
  aiReady: boolean
  isDemo: boolean
}) {
  return (
    <Tabs defaultValue="inbox" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="broadcast">Broadcast</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <span className="text-sm text-muted-foreground">Connected: {props.creds.display_phone ?? "your number"}</span>
      </div>

      <TabsContent value="inbox"><Inbox slug={props.slug} conversations={props.conversations} aiReady={props.aiReady} /></TabsContent>
      <TabsContent value="broadcast">
        <BroadcastComposer slug={props.slug} lists={props.lists} segments={props.segments} phoneCount={props.phoneCount} isDemo={props.isDemo} hasWaba={!!props.creds.waba_id} />
      </TabsContent>
      <TabsContent value="settings">
        <div className="grid gap-6 lg:grid-cols-2">
          <AutoReplyForm slug={props.slug} initial={props.creds.auto_reply} aiReady={props.aiReady} />
          <ConnectionInfo slug={props.slug} creds={props.creds} webhookUrl={props.webhookUrl} />
        </div>
      </TabsContent>
    </Tabs>
  )
}

function Inbox({ slug, conversations, aiReady }: { slug: string; conversations: Convo[]; aiReady: boolean }) {
  const [activeId, setActiveId] = useState<string | null>(conversations[0]?.id ?? null)
  if (conversations.length === 0)
    return <Empty title="No conversations yet">When someone messages your WhatsApp number, the conversation shows up here. Broadcasts you send also start threads.</Empty>
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="max-h-[600px] overflow-y-auto rounded-xl border bg-card">
        {conversations.map((c) => (
          <button key={c.id} onClick={() => setActiveId(c.id)}
            className={cn("flex w-full items-start gap-3 border-b px-4 py-3 text-left last:border-0 hover:bg-muted/50", activeId === c.id && "bg-muted")}>
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-sm font-semibold text-success">
              {(c.name ?? c.wa_phone).slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{c.name ?? `+${c.wa_phone}`}</p>
                {c.unread > 0 && <span className="rounded-full bg-success px-1.5 text-xs font-semibold text-success-foreground">{c.unread}</span>}
              </div>
              <p className="truncate text-xs text-muted-foreground">{c.last_body ?? "—"}</p>
            </div>
          </button>
        ))}
      </div>
      {activeId ? <Thread key={activeId} slug={slug} conversationId={activeId} aiReady={aiReady} /> : <div className="rounded-xl border bg-card" />}
    </div>
  )
}

function Thread({ slug, conversationId, aiReady }: { slug: string; conversationId: string; aiReady: boolean }) {
  const [thread, setThread] = useState<Awaited<ReturnType<typeof loadThread>> | null>(null)
  const [text, setText] = useState("")
  const [sending, startSend] = useTransition()
  const [suggesting, startSuggest] = useTransition()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadThread(slug, conversationId).then(setThread) }, [slug, conversationId])
  useEffect(() => { endRef.current?.scrollIntoView() }, [thread])

  function send() {
    if (!text.trim()) return
    const body = text.trim()
    startSend(async () => {
      const r = await sendReply(slug, conversationId, body)
      if (!r.ok) return void toast.error(r.error)
      setText("")
      setThread(await loadThread(slug, conversationId))
    })
  }
  function suggest() {
    startSuggest(async () => {
      const r = await suggestReply(slug, conversationId)
      if (!r.ok) return void toast.error(r.error)
      setText(r.reply)
    })
  }

  if (!thread) return <div className="flex h-[600px] items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="flex h-[600px] flex-col rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <p className="font-medium">{thread.name ?? `+${thread.phone}`}</p>
        <p className="text-xs text-muted-foreground">{thread.canFreeform ? "Can reply freely (within 24h)" : "24h window closed — only templates can reach them"}</p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-muted/20 p-4">
        {thread.messages.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={endRef} />
      </div>
      <div className="border-t p-3">
        {thread.canFreeform ? (
          <div className="flex items-end gap-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Type a reply…" className="resize-none"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }} />
            <div className="flex flex-col gap-1.5">
              {aiReady && <Button variant="outline" size="sm" onClick={suggest} disabled={suggesting} title="Draft a reply with AI"><Sparkles /> {suggesting ? "…" : "Draft"}</Button>}
              <Button size="sm" onClick={send} disabled={sending || !text.trim()}><Send /> Send</Button>
            </div>
          </div>
        ) : (
          <p className="rounded-md bg-muted px-3 py-2 text-center text-xs text-muted-foreground">Send an approved template from the Broadcast tab to re-open this conversation.</p>
        )}
      </div>
    </div>
  )
}

function Bubble({ m }: { m: ThreadMessage }) {
  const out = m.direction === "out"
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[75%] rounded-2xl px-3 py-2 text-sm", out ? "bg-success text-success-foreground" : "bg-card border")}>
        {m.type === "template" && <p className="mb-0.5 text-xs opacity-70">Template · {m.template_name}</p>}
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
        <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", out ? "text-success-foreground/70" : "text-muted-foreground")}>
          {m.auto && <span>auto ·</span>}
          <span>{new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
          {out && (m.status === "read" ? <CheckCheck className="size-3" /> : m.status === "delivered" ? <CheckCheck className="size-3 opacity-60" /> : m.status === "failed" ? <span className="text-destructive-foreground">failed</span> : <Check className="size-3 opacity-60" />)}
        </div>
      </div>
    </div>
  )
}

function ConnectionInfo({ slug, creds, webhookUrl }: { slug: string; creds: { display_phone: string | null; waba_id: string | null; verify_token: string; last_ok_at: string | null }; webhookUrl: string }) {
  return (
    <Panel title="Connection" description="Your WhatsApp Cloud API setup.">
      <div className="space-y-3 text-sm">
        <Row label="Number" value={creds.display_phone ?? "—"} extra={<Pill tone={creds.last_ok_at ? "green" : "honey"}>{creds.last_ok_at ? "verified" : "unverified"}</Pill>} />
        <Row label="WABA ID" value={creds.waba_id ?? "not set — needed for templates"} />
        <CopyField label="Webhook callback URL" value={webhookUrl} />
        <CopyField label="Verify token" value={creds.verify_token} />
        <form action={`/w/${slug}/whatsapp`}>
          <p className="text-xs text-muted-foreground">To disconnect or update credentials, contact your admin, or re-run setup from a fresh connection.</p>
        </form>
      </div>
    </Panel>
  )
}

function Row({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="flex items-center gap-2 text-right">{value} {extra}</span></div>
}
function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-xs">{value}</code>
        <button type="button" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copied"))} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Copy ${label}`}><Copy className="size-4" /></button>
      </div>
    </div>
  )
}
