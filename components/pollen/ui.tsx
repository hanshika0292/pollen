import { cn } from "@/lib/utils"

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, hint, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-5", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function Panel({ title, description, actions, children, className }: {
  title?: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            {title && <h2 className="font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

const TONES = {
  green: "bg-success/12 text-success border-success/25",
  honey: "bg-honey/20 text-honey-foreground border-honey/40",
  gray: "bg-muted text-muted-foreground border-border",
  red: "bg-destructive/10 text-destructive border-destructive/25",
  blue: "bg-chart-3/12 text-chart-3 border-chart-3/25",
} as const

export function Pill({ tone = "gray", children, className }: { tone?: keyof typeof TONES; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>{children}</span>
}

export const STATUS_TONE: Record<string, keyof typeof TONES> = {
  subscribed: "green", unsubscribed: "gray", bounced: "red", complained: "red",
  draft: "gray", sending: "honey", sent: "green", failed: "red",
  active: "green", suspended: "red",
}

export function pct(n: number, d: number) {
  if (!d) return "—"
  return `${Math.round((n / d) * 1000) / 10}%`
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

export function fmtNum(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("en-IN")
}
