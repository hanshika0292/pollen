import Link from "next/link"
import { requireWorkspace } from "@/lib/auth"
import { Shell } from "@/components/pollen/shell"

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireWorkspace(slug)
  const base = `/w/${slug}`
  const banner = ctx.viaAdmin ? (
    <div className="flex items-center justify-center gap-3 bg-honey px-4 py-2 text-sm font-medium text-honey-foreground">
      Viewing {ctx.workspace.name} as Pollen admin{ctx.workspace.is_demo ? " · demo tenant" : ""}
      <Link href="/admin" className="underline underline-offset-2">Back to HQ</Link>
    </div>
  ) : ctx.workspace.is_demo ? (
    <div className="bg-honey/25 px-4 py-2 text-center text-sm text-honey-foreground">Demo workspace — contacts are fictional and sending is disabled.</div>
  ) : null

  return (
    <Shell
      title={ctx.workspace.name}
      subtitle={`${ctx.workspace.plan[0].toUpperCase()}${ctx.workspace.plan.slice(1)} plan · ${ctx.role}`}
      user={ctx.user}
      banner={banner}
      nav={[
        { href: base, label: "Home", icon: "LayoutDashboard", exact: true },
        { href: `${base}/campaigns`, label: "Campaigns", icon: "Mail" },
        { href: `${base}/whatsapp`, label: "WhatsApp", icon: "MessageCircle" },
        { href: `${base}/contacts`, label: "Contacts", icon: "Users" },
        { href: `${base}/lists`, label: "Lists", icon: "ListChecks" },
        { href: `${base}/segments`, label: "Segments", icon: "Filter" },
        { href: `${base}/brand`, label: "Brand kit", icon: "Palette" },
        { href: `${base}/settings`, label: "Settings", icon: "Settings" },
      ]}
    >
      {children}
    </Shell>
  )
}
