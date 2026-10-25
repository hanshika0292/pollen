"use client"

import { useActionState, useState, useTransition } from "react"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"
import { saveBrandKit, type Result } from "@/lib/actions/settings"
import { aiBrandVoice } from "@/lib/actions/ai"
import type { BrandVoice } from "@/lib/ai/features"
import type { BrandKit } from "@/lib/tenant"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Panel, Pill } from "@/components/pollen/ui"

export function BrandKitForm({ slug, brand, editable }: { slug: string; brand: BrandKit; editable: boolean }) {
  const [state, action, pending] = useActionState<Result, FormData>(saveBrandKit.bind(null, slug), {})
  const [primary, setPrimary] = useState(brand.primary_color)
  const [accent, setAccent] = useState(brand.accent_color ?? "#f2c14e")
  return (
    <Panel title="Look & legal" description="Used in every email's header and footer.">
      <form action={action} className="space-y-4">
        <fieldset disabled={!editable} className="space-y-4">
          <F label="Business name in emails" name="display_name" defaultValue={brand.name} required />
          <F label="Logo URL" name="logo_url" defaultValue={brand.logo_url ?? ""} placeholder="https://… (PNG, ~200×80)" />
          <div className="grid grid-cols-2 gap-3">
            <Color label="Main colour" name="primary_color" value={primary} onChange={setPrimary} />
            <Color label="Accent colour" name="accent_color" value={accent} onChange={setAccent} />
          </div>
          <F label="Website" name="website" defaultValue={brand.website ?? ""} placeholder="https://" />
          <div className="space-y-1.5">
            <Label htmlFor="address">Business address <span className="font-normal text-muted-foreground">(required by anti-spam law)</span></Label>
            <Textarea id="address" name="address" defaultValue={brand.address ?? ""} rows={2} />
          </div>
          <F label="Footer note" name="footer_text" defaultValue={brand.footer_text ?? ""} placeholder="You're getting this because…" />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save brand kit"}</Button>
            {state.message && <span className="text-sm text-success">{state.message}</span>}
            {state.error && <span className="text-sm text-destructive">{state.error}</span>}
          </div>
        </fieldset>
        {!editable && <p className="text-xs text-muted-foreground">Only owners and admins can edit the brand kit.</p>}
      </form>
    </Panel>
  )
}

function F({ label, name, ...props }: { label: string; name: string } & React.ComponentProps<"input">) {
  return <div className="space-y-1.5"><Label htmlFor={name}>{label}</Label><Input id={name} name={name} {...props} /></div>
}

function Color({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <div className="flex items-center gap-2 rounded-md border bg-card pl-1.5">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-7 cursor-pointer rounded border-0 bg-transparent" aria-label={`${label} picker`} />
        <input id={name} name={name} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 min-w-0 flex-1 bg-transparent font-mono text-sm outline-none" />
      </div>
    </div>
  )
}

export function VoicePanel({ slug, voice: initial, website, aiReady }: { slug: string; voice: BrandVoice | null; website: string; aiReady: boolean }) {
  const [voice, setVoice] = useState(initial)
  const [site, setSite] = useState(website)
  const [samples, setSamples] = useState("")
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(!initial)

  function learn() {
    start(async () => {
      const r = await aiBrandVoice(slug, { website: site, samples })
      if (!r.ok) return void toast.error(r.error)
      setVoice(r.voice)
      setOpen(false)
      toast.success("Brand voice updated — new drafts will use it.")
    })
  }

  return (
    <Panel title="Brand voice" description="Pollen reads your website and past writing, then writes like you."
      actions={voice && !open ? <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Re-learn</Button> : undefined}>
      <div className="space-y-5">
        {open && (
          <div className="space-y-3 rounded-lg bg-muted/40 p-4">
            <div className="space-y-1.5"><Label htmlFor="site">Website</Label><Input id="site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://yourbusiness.com" /></div>
            <div className="space-y-1.5">
              <Label htmlFor="samples">Writing samples <span className="font-normal text-muted-foreground">(optional, makes it much better)</span></Label>
              <Textarea id="samples" value={samples} onChange={(e) => setSamples(e.target.value)} rows={5} placeholder="Paste a past email, a few Instagram captions, your About page…" />
            </div>
            <Button onClick={learn} disabled={!aiReady || pending}><Sparkles /> {pending ? "Reading & learning…" : "Learn my voice"}</Button>
            {!aiReady && <p className="text-xs text-muted-foreground">Connect an AI key in Settings first.</p>}
          </div>
        )}
        {voice ? (
          <div className="space-y-4 text-sm">
            <p className="text-base leading-relaxed">{voice.summary}</p>
            <div className="flex flex-wrap gap-1.5">
              {voice.tone.map((t) => <Pill key={t} tone="green">{t}</Pill>)}
              <Pill>{voice.formality}</Pill><Pill>emoji: {voice.emoji}</Pill>
            </div>
            <p><span className="font-medium">Audience · </span><span className="text-muted-foreground">{voice.audience}</span></p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className="mb-1 font-medium text-success">Do</p><ul className="list-disc space-y-1 pl-4 text-muted-foreground">{voice.do.map((d) => <li key={d}>{d}</li>)}</ul></div>
              <div><p className="mb-1 font-medium text-destructive">Don't</p><ul className="list-disc space-y-1 pl-4 text-muted-foreground">{voice.dont.map((d) => <li key={d}>{d}</li>)}</ul></div>
            </div>
            {voice.sample_phrases.length > 0 && (
              <div><p className="mb-1.5 font-medium">Sounds like</p>
                <div className="space-y-1.5">{voice.sample_phrases.map((s) => <p key={s} className="rounded-md border-l-2 border-honey bg-honey/10 px-3 py-1.5 italic">“{s}”</p>)}</div></div>
            )}
          </div>
        ) : !open ? null : <p className="text-sm text-muted-foreground">No voice guide yet.</p>}
      </div>
    </Panel>
  )
}
