import { requireWorkspace } from "@/lib/auth"
import { withTenant } from "@/lib/db"
import { baseUrl } from "@/lib/tenant"
import { hasAi } from "@/lib/ai/core"
import { PageHeader } from "@/components/pollen/ui"
import { ConnectWhatsApp } from "./connect"
import { WhatsAppWorkspace } from "./workspace"

export const metadata = { title: "WhatsApp" }

export default async function WhatsAppPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireWorkspace(slug)
  const base = await baseUrl()
  const webhookUrl = `${base}/api/wa/webhook/${ctx.workspace.id}`

  const data = await withTenant(ctx.workspace.id, async (db) => {
    const creds = await db.one<{ display_phone: string | null; waba_id: string | null; verify_token: string; auto_reply: { mode: string; text?: string }; last_ok_at: string | null }>(
      `select display_phone, waba_id, verify_token, auto_reply, last_ok_at from wa_credentials`)
    if (!creds) return { creds: null as null }
    const conversations = await db.query<{ id: string; wa_phone: string; name: string | null; last_message_at: string | null; last_inbound_at: string | null; unread: number; last_body: string | null }>(`
      select c.id, c.wa_phone, c.name, c.last_message_at, c.last_inbound_at, c.unread,
             (select body from wa_messages m where m.conversation_id = c.id order by created_at desc limit 1) as last_body
        from wa_conversations c order by c.last_message_at desc nulls last limit 100`)
    const lists = await db.query<{ id: string; name: string }>(`select id, name from lists order by name`)
    const segments = await db.query<{ id: string; name: string }>(`select id, name from segments order by name`)
    const withPhone = await db.one<{ n: number }>(`select count(*)::int as n from contacts where status='subscribed' and coalesce(phone,'') <> ''`)
    return { creds, conversations, lists, segments, phoneCount: withPhone?.n ?? 0 }
  })

  return (
    <>
      <PageHeader title="WhatsApp" description="Two-way conversations and template broadcasts from your own WhatsApp Business number." />
      {!data.creds ? (
        <ConnectWhatsApp slug={slug} webhookUrl={webhookUrl} />
      ) : (
        <WhatsAppWorkspace
          slug={slug}
          creds={data.creds}
          webhookUrl={webhookUrl}
          conversations={data.conversations}
          lists={data.lists}
          segments={data.segments}
          phoneCount={data.phoneCount}
          aiReady={await hasAi(ctx.workspace.id)}
          isDemo={ctx.workspace.is_demo}
        />
      )}
    </>
  )
}
