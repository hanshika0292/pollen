"use client"

import { Copy } from "lucide-react"
import { toast } from "sonner"

/** Shows a one-time password exactly once, with copy-to-clipboard. */
export function CredentialNotice({ email, password, loginUrl }: { email?: string; password: string; loginUrl?: string }) {
  const text = [loginUrl && `Login: ${loginUrl}`, email && `Email: ${email}`, `Temporary password: ${password}`].filter(Boolean).join("\n")
  return (
    <div className="rounded-lg border border-honey/50 bg-honey/10 p-4 text-sm">
      <p className="mb-2 font-medium text-honey-foreground">Shown once — copy it now.</p>
      <pre className="whitespace-pre-wrap rounded-md bg-card p-3 font-mono text-xs">{text}</pre>
      <button
        type="button"
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}
      >
        <Copy className="size-3.5" /> Copy login details
      </button>
    </div>
  )
}
