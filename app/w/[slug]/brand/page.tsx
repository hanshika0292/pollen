import { canManage, requireWorkspace } from "@/lib/auth"
import { withTenant } from "@/lib/db"
import { hasAi } from "@/lib/ai/core"
import { loadBrand } from "@/lib/tenant"
import { PageHeader } from "@/components/pollen/ui"
import { BrandKitForm, VoicePanel } from "./client"

export const metadata = { title: "Brand kit" }

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireWorkspace(slug)
  const brand = await withTenant(ctx.workspace.id, (db) => loadBrand(db, ctx.workspace.name, ctx.workspace.website))
  return (
    <>
      <PageHeader title="Brand kit" description="How your emails look and sound. Every AI draft uses your brand voice." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
        <BrandKitForm slug={slug} brand={brand} editable={canManage(ctx)} />
        <VoicePanel slug={slug} voice={brand.voice} website={brand.website ?? ""} aiReady={await hasAi(ctx.workspace.id)} />
      </div>
    </>
  )
}
