"use client"

import { useActionState } from "react"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { connectWhatsApp, type Result } from "@/lib/actions/whatsapp"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Panel } from "@/components/pollen/ui"

export function ConnectWhatsApp({ slug, webhookUrl, verifyToken }: { slug: string; webhookUrl: string; verifyToken?: string }) {
  const [state, action, pending] = useActionState<Result, FormData>(connectWhatsApp.bind(null, slug), {})
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Panel title="Connect your WhatsApp number" description="Bring your own WhatsApp Business number via the official Cloud API. Your credentials stay encrypted and are used only for your account.">
        <form action={action} className="space-y-4">
          <Field label="Phone number ID" name="phone_number_id" placeholder="From Meta → WhatsApp → API Setup" required />
          <Field label="WhatsApp Business Account (WABA) ID" name="waba_id" placeholder="Needed to list templates" />
          <div className="space-y-1.5">
            <Label htmlFor="token">Permanent access token</Label>
            <Input id="token" name="token" type="password" autoComplete="off" required placeholder="System-user token from Meta Business settings" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secret">App secret <span className="font-normal text-muted-foreground">(recommended — secures your webhook)</span></Label>
            <Input id="secret" name="secret" type="password" autoComplete="off" placeholder="Meta app → Settings → Basic → App Secret" />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          {state.ok && <p className="text-sm text-success">{state.message}</p>}
          <Button type="submit" disabled={pending}>{pending ? "Verifying with Meta…" : "Connect WhatsApp"}</Button>
        </form>
      </Panel>
      <div className="space-y-6">
        <Panel title="Then set your webhook in Meta" description="In your Meta app → WhatsApp → Configuration, paste these two values so replies reach Pollen.">
          <div className="space-y-3">
            <CopyRow label="Callback URL" value={webhookUrl} />
            <CopyRow label="Verify token" value={verifyToken ?? "Generated when you connect above"} copyable={!!verifyToken} />
            <p className="text-xs text-muted-foreground">After connecting, subscribe your webhook to the <code>messages</code> field. The verify token appears here once you&apos;ve connected.</p>
          </div>
        </Panel>
        <Panel title="Where to find these">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>developers.facebook.com → your app → WhatsApp → API Setup: copy the <strong>Phone number ID</strong> and <strong>WABA ID</strong>.</li>
            <li>Business settings → Users → System users: create one, generate a <strong>permanent token</strong> with <code>whatsapp_business_messaging</code> and <code>whatsapp_business_management</code>.</li>
            <li>App → Settings → Basic: copy the <strong>App secret</strong>.</li>
          </ol>
        </Panel>
      </div>
    </div>
  )
}

function Field({ label, name, ...props }: { label: string; name: string } & React.ComponentProps<"input">) {
  return <div className="space-y-1.5"><Label htmlFor={name}>{label}</Label><Input id={name} name={name} {...props} /></div>
}

function CopyRow({ label, value, copyable = true }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-xs">{value}</code>
        {copyable && (
          <button type="button" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copied"))} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Copy ${label}`}>
            <Copy className="size-4" />
          </button>
        )}
      </div>
    </div>
  )
}
