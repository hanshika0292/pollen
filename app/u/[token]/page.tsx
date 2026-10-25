import { redirect } from "next/navigation"
import { withGlobal, withTenant } from "@/lib/db"
import { readToken, recordEvent } from "@/lib/tracking"
import { loadBrand } from "@/lib/tenant"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Email preferences", robots: { index: false } }

export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params
  const { done } = await searchParams
  const t = readToken(token)
  if (!t) return <Shell title="This link has expired">You can reply to any email from us and ask to be removed.</Shell>

  const ws = await withGlobal((db) => db.one<{ name: string; website: string | null }>(`select name, website from workspaces where id = $1`, [t.w]))
  if (!ws) return <Shell title="This link has expired">You can reply to any email from us and ask to be removed.</Shell>
  const { brand, contact } = await withTenant(t.w, async (db) => ({
    brand: await loadBrand(db, ws.name, ws.website),
    contact: await db.one<{ email: string; status: string }>(`select email::text as email, status from contacts where id = $1`, [t.k]),
  }))
  if (!contact) return <Shell title="You're not on this list">There's nothing more to do.</Shell>

  async function confirm() {
    "use server"
    await recordEvent(t!, "unsubscribe", { via: "page" })
    redirect(`/u/${token}?done=1`)
  }

  if (done || contact.status !== "subscribed")
    return <Shell title="You're unsubscribed" brand={brand.name} color={brand.primary_color}>{contact.email} won't get marketing emails from {brand.name} anymore.</Shell>

  return (
    <Shell title={`Unsubscribe from ${brand.name}?`} brand={brand.name} color={brand.primary_color}>
      <p className="mb-5">{contact.email} will stop receiving marketing emails from {brand.name}.</p>
      <form action={confirm}><Button type="submit" style={{ background: brand.primary_color }}>Unsubscribe</Button></form>
    </Shell>
  )
}

function Shell({ title, children, brand, color }: { title: string; children: React.ReactNode; brand?: string; color?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        {brand && <p className="mb-6 text-lg font-bold" style={{ color }}>{brand}</p>}
        <h1 className="mb-3 text-xl font-semibold">{title}</h1>
        <div className="text-sm text-muted-foreground">{children}</div>
        <p className="mt-8 text-xs text-muted-foreground">Sent with Pollen</p>
      </div>
    </main>
  )
}
