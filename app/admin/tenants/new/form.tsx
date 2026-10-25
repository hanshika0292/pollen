"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { createTenant, type ActionState } from "../../actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Panel } from "@/components/pollen/ui"
import { CredentialNotice } from "@/components/pollen/credential-notice"

const slugify = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)

export function NewTenantForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createTenant, {})
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [email, setEmail] = useState("")

  if (state.ok) {
    return (
      <Panel title="Workspace ready">
        <div className="space-y-4">
          <p className="text-sm">{state.message}</p>
          {state.tempPassword && <CredentialNotice email={email} password={state.tempPassword} loginUrl={typeof window !== "undefined" ? `${window.location.origin}/login` : undefined} />}
          <div className="flex gap-2">
            <Button asChild><Link href={state.href!}>Open tenant</Link></Button>
            <Button variant="outline" asChild><Link href="/admin">Back to tenants</Link></Button>
          </div>
        </div>
      </Panel>
    )
  }

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-2">
      <Panel title="Business">
        <div className="space-y-4">
          <Field label="Business name" name="name" required onChange={(v) => !slugTouched && setSlug(slugify(v))} />
          <div className="space-y-2">
            <Label htmlFor="slug">Workspace URL</Label>
            <div className="flex items-center rounded-md border bg-muted/40 pl-3 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring/40">
              /w/
              <input id="slug" name="slug" required value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value) }} className="h-9 flex-1 bg-transparent px-1 text-foreground outline-none" />
            </div>
          </div>
          <Field label="Industry" name="industry" placeholder="e.g. Café, salon, D2C skincare" />
          <Field label="Website" name="website" placeholder="https://" />
          <div className="space-y-2">
            <Label htmlFor="plan">Plan</Label>
            <select id="plan" name="plan" defaultValue="starter" className="h-9 w-full rounded-md border bg-card px-3 text-sm">
              <option value="trial">Trial</option><option value="starter">Starter</option><option value="growth">Growth</option><option value="scale">Scale</option>
            </select>
          </div>
        </div>
      </Panel>
      <div className="space-y-6">
        <Panel title="Owner" description="The person who'll run marketing for this business.">
          <div className="space-y-4">
            <Field label="Full name" name="ownerName" required />
            <Field label="Email" name="ownerEmail" type="email" required onChange={setEmail} />
          </div>
        </Panel>
        <Panel title="Internal notes" description="Only visible to Pollen staff.">
          <Textarea name="notes" rows={3} placeholder="Deal context, onboarding call date, special terms…" />
        </Panel>
        {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" disabled={pending} className="w-full">{pending ? "Creating…" : "Create workspace"}</Button>
      </div>
    </form>
  )
}

function Field({ label, name, onChange, ...props }: { label: string; name: string; onChange?: (v: string) => void } & Omit<React.ComponentProps<"input">, "onChange">) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} onChange={(e) => onChange?.(e.target.value)} {...props} />
    </div>
  )
}
