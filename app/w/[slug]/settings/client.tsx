"use client"

import { useActionState, useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { inviteTeammate, makeDefaultAi, removeAiKey, removeSender, saveAiKey, saveSender, type Result } from "@/lib/actions/settings"
import { PROVIDERS as PROVIDER_OPTIONS } from "@/lib/ai/providers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pill } from "@/components/pollen/ui"
import { CredentialNotice } from "@/components/pollen/credential-notice"

type Provider = keyof typeof PROVIDER_OPTIONS
const sel = "h-9 w-full rounded-md border bg-card px-3 text-sm"

function useToastResult(state: Result, reset?: () => void) {
  useEffect(() => {
    if (state.ok && state.message && !state.tempPassword) { toast.success(state.message); reset?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
}

export function AiKeyForm({ slug }: { slug: string }) {
  const [provider, setProvider] = useState<Provider>("anthropic")
  const [state, action, pending] = useActionState<Result, FormData>(saveAiKey.bind(null, slug), {})
  const ref = useRef<HTMLFormElement>(null)
  useToastResult(state, () => ref.current?.reset())
  const p = PROVIDER_OPTIONS[provider]
  return (
    <form ref={ref} action={action} className="space-y-3 rounded-lg bg-muted/40 p-4">
      <p className="text-sm font-medium">Connect a provider</p>
      <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value as Provider)} className={sel} aria-label="Provider">
        {Object.entries(PROVIDER_OPTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <Input name="apiKey" type="password" autoComplete="off" placeholder={`API key (${p.keyHint})`} required aria-label="API key" />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1"><Label className="text-xs" htmlFor="qm">Writing model</Label><Input id="qm" name="quality_model" key={`q-${provider}`} defaultValue={p.quality} /></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor="fm">Fast model (reviews, segments)</Label><Input id="fm" name="fast_model" key={`f-${provider}`} defaultValue={p.fast} /></div>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Verifying key…" : "Verify & save"}</Button>
      <p className="text-xs text-muted-foreground">Keys are encrypted before storage and never shown again. <a className="underline" href={p.keysUrl} target="_blank" rel="noreferrer">Get a key</a></p>
    </form>
  )
}

export function AiKeyRow({ slug, manage, k }: { slug: string; manage: boolean; k: { provider: Provider; label: string; key_last4: string; quality_model: string; fast_model: string; is_default: boolean; last_ok_at: string | null } }) {
  const [pending, start] = useTransition()
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{k.label} <span className="font-normal text-muted-foreground">••••{k.key_last4}</span></p>
        <div className="flex gap-1.5">{k.is_default ? <Pill tone="green">primary</Pill> : <Pill>fallback</Pill>}</div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Writes with {k.quality_model} · reviews with {k.fast_model}</p>
      {manage && (
        <div className="mt-2 flex gap-3 text-xs">
          {!k.is_default && <button disabled={pending} className="text-primary hover:underline" onClick={() => start(() => makeDefaultAi(slug, k.provider))}>Make primary</button>}
          <button disabled={pending} className="text-destructive hover:underline" onClick={() => { if (confirm(`Disconnect ${k.label}?`)) start(() => removeAiKey(slug, k.provider)) }}>Disconnect</button>
        </div>
      )}
    </div>
  )
}

export function SenderForm({ slug }: { slug: string }) {
  const [provider, setProvider] = useState<"smtp" | "ses">("smtp")
  const [state, action, pending] = useActionState<Result, FormData>(saveSender.bind(null, slug), {})
  const ref = useRef<HTMLFormElement>(null)
  useToastResult(state, () => ref.current?.reset())
  return (
    <form ref={ref} action={action} className="space-y-3 rounded-lg bg-muted/40 p-4">
      <p className="text-sm font-medium">Connect a sender</p>
      <input type="hidden" name="provider" value={provider} />
      <div className="flex rounded-md border bg-card p-0.5 text-sm">
        {(["smtp", "ses"] as const).map((p) => <button type="button" key={p} onClick={() => setProvider(p)} className={`flex-1 rounded px-2 py-1 ${provider === p ? "bg-secondary font-medium" : "text-muted-foreground"}`}>{p === "smtp" ? "SMTP" : "Amazon SES"}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input name="from_name" placeholder="From name" required aria-label="From name" />
        <Input name="from_email" type="email" placeholder="hello@yourdomain.com" required aria-label="From email" />
      </div>
      <Input name="reply_to" type="email" placeholder="Reply-to (optional)" aria-label="Reply-to" />
      {provider === "smtp" ? (
        <>
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <Input name="host" placeholder="smtp.yourprovider.com" required aria-label="SMTP host" />
            <Input name="port" defaultValue="587" required aria-label="Port" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input name="user" placeholder="Username" required aria-label="SMTP username" />
            <Input name="pass" type="password" placeholder="Password" required aria-label="SMTP password" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="secure" /> Use SSL (port 465)</label>
        </>
      ) : (
        <>
          <Input name="region" placeholder="Region, e.g. ap-south-1" required aria-label="AWS region" />
          <Input name="accessKeyId" placeholder="Access key ID" required aria-label="Access key ID" />
          <Input name="secretAccessKey" type="password" placeholder="Secret access key" required aria-label="Secret access key" />
          <p className="text-xs text-muted-foreground">Use an IAM user limited to ses:SendEmail, with your domain verified in SES.</p>
        </>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Save sender"}</Button>
    </form>
  )
}

export function SenderRow({ slug, manage, s }: { slug: string; manage: boolean; s: { id: string; provider: string; from_name: string; from_email: string; reply_to: string | null; is_default: boolean; last_ok_at: string | null } }) {
  const [pending, start] = useTransition()
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-medium">{s.from_name} <span className="font-normal text-muted-foreground">&lt;{s.from_email}&gt;</span></p>
        <div className="flex shrink-0 gap-1.5"><Pill>{s.provider.toUpperCase()}</Pill>{s.is_default && <Pill tone="green">default</Pill>}</div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{s.last_ok_at ? "Verified" : "Not verified yet — send a test email"}{s.reply_to ? ` · replies to ${s.reply_to}` : ""}</p>
      {manage && <button disabled={pending} className="mt-2 text-xs text-destructive hover:underline" onClick={() => { if (confirm(`Remove ${s.from_email}?`)) start(() => removeSender(slug, s.id)) }}>Remove</button>}
    </div>
  )
}

export function TeamForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<Result, FormData>(inviteTeammate.bind(null, slug), {})
  const ref = useRef<HTMLFormElement>(null)
  useToastResult(state, () => ref.current?.reset())
  return (
    <form ref={ref} action={action} className="space-y-3 rounded-lg bg-muted/40 p-4">
      <p className="text-sm font-medium">Add a teammate</p>
      <div className="grid grid-cols-2 gap-2">
        <Input name="name" placeholder="Name" required aria-label="Name" />
        <Input name="email" type="email" placeholder="Email" required aria-label="Email" />
      </div>
      <select name="role" defaultValue="member" className={sel} aria-label="Role"><option value="member">Member — create & send</option><option value="admin">Admin — also manage settings</option></select>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add teammate"}</Button>
      {state.ok && state.tempPassword && <CredentialNotice password={state.tempPassword} />}
    </form>
  )
}
