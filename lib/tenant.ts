import "server-only"
import { headers } from "next/headers"
import type { Db } from "./db"
import type { Brand } from "./email/render"
import type { BrandVoice } from "./ai/features"
import { compileRules, rulesSchema } from "./segments"

export type BrandKit = Brand & { voice: BrandVoice | null }

export async function loadBrand(db: Db, workspaceName: string, website: string | null): Promise<BrandKit> {
  const kit = await db.one<{
    display_name: string | null; logo_url: string | null; primary_color: string; accent_color: string
    website: string | null; address: string | null; footer_text: string | null; voice: BrandVoice | null
  }>(`select display_name, logo_url, primary_color, accent_color, website, address, footer_text, voice from brand_kits`)
  return {
    name: kit?.display_name || workspaceName,
    logo_url: kit?.logo_url ?? null,
    primary_color: kit?.primary_color ?? "#2f6f4f",
    accent_color: kit?.accent_color ?? "#f2c14e",
    website: kit?.website || website,
    address: kit?.address ?? null,
    footer_text: kit?.footer_text ?? null,
    voice: kit?.voice ?? null,
  }
}

export type Audience = { type: "all" } | { type: "list"; id: string } | { type: "segment"; id: string }

/**
 * SQL (over alias c) selecting the *sendable* contacts for an audience.
 * Unsubscribed/bounced contacts are excluded no matter what a segment says.
 */
export async function audienceWhere(db: Db, audience: Audience): Promise<{ sql: string; params: unknown[] }> {
  if (audience.type === "list")
    return { sql: `c.status = 'subscribed' and exists (select 1 from list_members lm where lm.contact_id = c.id and lm.list_id = $1)`, params: [audience.id] }
  if (audience.type === "segment") {
    const seg = await db.one<{ rules: unknown }>(`select rules from segments where id = $1`, [audience.id])
    if (!seg) throw new Error("Segment not found")
    const compiled = compileRules(rulesSchema.parse(seg.rules))
    return { sql: `c.status = 'subscribed' and ${compiled.sql}`, params: compiled.params }
  }
  return { sql: `c.status = 'subscribed'`, params: [] }
}

export async function audienceCount(db: Db, audience: Audience) {
  const { sql, params } = await audienceWhere(db, audience)
  const row = await db.one<{ n: number }>(`select count(*)::int as n from contacts c where ${sql}`, params)
  return row?.n ?? 0
}

/** Absolute base URL for links inside emails (tracking, unsubscribe). */
export async function baseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "")
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}
