"use server"

import { revalidatePath } from "next/cache"
import { requireWorkspace } from "@/lib/auth"
import { withTenant } from "@/lib/db"
import { loadBrand, audienceCount } from "@/lib/tenant"
import { friendlyAiError } from "@/lib/ai/core"
import { composeEmail, rewriteEmail, scoreEmail, buildSegment, extractBrandVoice, REWRITES, type RewriteKind, type Scorecard, type BrandVoice } from "@/lib/ai/features"
import { fetchSiteText } from "@/lib/ai/website"
import { emailContentSchema, type EmailContent } from "@/lib/email/blocks"
import { compileRules, rulesSchema, validateRules, type Rules } from "@/lib/segments"
import type { Db } from "@/lib/db"

type Ok<T> = { ok: true } & T
type Err = { ok: false; error: string }

async function context(slug: string) {
  const ctx = await requireWorkspace(slug)
  const brand = await withTenant(ctx.workspace.id, (db) => loadBrand(db, ctx.workspace.name, ctx.workspace.website))
  return {
    ctx,
    brand,
    run: { workspaceId: ctx.workspace.id, userId: ctx.viaAdmin ? null : ctx.user.id },
    brandInput: { businessName: brand.name, industry: ctx.workspace.industry, website: brand.website, voice: brand.voice },
  }
}

export async function aiCompose(
  slug: string,
  campaignId: string,
  input: { goal: string; brief: string; ctaUrl: string; length: "short" | "medium" | "long" },
): Promise<Ok<{ content: EmailContent; scorecard: Scorecard }> | Err> {
  if (input.brief.trim().length < 10) return { ok: false, error: "Tell the AI a bit more about what this email is for." }
  const { ctx, run, brand, brandInput } = await context(slug)
  try {
    const result = await composeEmail(run, { ...brandInput, ...input, hasAddress: !!brand.address })
    await withTenant(ctx.workspace.id, (db) =>
      db.query(`update campaigns set subject = $2, preview_text = $3, blocks = $4, quality = $5, brief = $6 where id = $1 and status = 'draft'`,
        [campaignId, result.content.subject, result.content.preview_text, JSON.stringify(result.content.blocks), result.scorecard, input.brief]),
    )
    revalidatePath(`/w/${slug}/campaigns/${campaignId}`)
    return { ok: true, ...result }
  } catch (e) {
    console.error("[aiCompose]", e)
    return { ok: false, error: friendlyAiError(e) }
  }
}

export async function aiRewrite(slug: string, content: EmailContent, kind: RewriteKind): Promise<Ok<{ content: EmailContent }> | Err> {
  if (!(kind in REWRITES)) return { ok: false, error: "Unknown rewrite." }
  const { run, brandInput } = await context(slug)
  try {
    const { output } = await rewriteEmail(run, { ...brandInput, content: emailContentSchema.parse(content), kind })
    return { ok: true, content: output }
  } catch (e) {
    console.error("[aiRewrite]", e)
    return { ok: false, error: friendlyAiError(e) }
  }
}

export async function aiScore(slug: string, campaignId: string, content: EmailContent, goal: string): Promise<Ok<{ scorecard: Scorecard }> | Err> {
  const { ctx, run, brand, brandInput } = await context(slug)
  try {
    const scorecard = await scoreEmail(run, { ...brandInput, goal: goal || "Engage subscribers", content: emailContentSchema.parse(content), hasAddress: !!brand.address })
    await withTenant(ctx.workspace.id, (db) => db.query(`update campaigns set quality = $2 where id = $1`, [campaignId, scorecard]))
    return { ok: true, scorecard }
  } catch (e) {
    console.error("[aiScore]", e)
    return { ok: false, error: friendlyAiError(e) }
  }
}

export async function aiSegment(slug: string, request: string): Promise<Ok<{ name: string; description: string; rules: Rules; assumptions: string[]; count: number }> | Err> {
  if (request.trim().length < 5) return { ok: false, error: "Describe who you want to reach." }
  const { ctx, run } = await context(slug)
  try {
    const facts = await withTenant(ctx.workspace.id, async (db) => ({
      lists: await db.query<{ id: string; name: string }>(`select id, name from lists order by name`),
      tags: (await db.query<{ t: string }>(`select distinct unnest(tags) as t from contacts order by 1 limit 100`)).map((r) => r.t),
      attributeKeys: (await db.query<{ k: string }>(`select distinct jsonb_object_keys(attributes) as k from contacts limit 50`)).map((r) => r.k),
      sources: (await db.query<{ s: string }>(`select distinct source as s from contacts`)).map((r) => r.s),
    }))
    const draft = await buildSegment(run, { request, ...facts })
    const count = await withTenant(ctx.workspace.id, (db) => segmentCount(db, draft.rules))
    return { ok: true, ...draft, count }
  } catch (e) {
    console.error("[aiSegment]", e)
    return { ok: false, error: e instanceof Error && e.message.startsWith("Couldn't") ? e.message : friendlyAiError(e) }
  }
}

async function segmentCount(db: Db, rules: Rules) {
  const { sql, params } = compileRules(rules)
  return (await db.one<{ n: number }>(`select count(*)::int as n from contacts c where ${sql}`, params))?.n ?? 0
}

export async function previewSegment(slug: string, rules: Rules): Promise<Ok<{ count: number; sample: { email: string; first_name: string | null }[] }> | Err> {
  const ctx = await requireWorkspace(slug)
  const parsed = rulesSchema.safeParse(rules)
  if (!parsed.success) return { ok: false, error: "Those rules aren't valid." }
  return withTenant(ctx.workspace.id, async (db) => {
    const listIds = (await db.query<{ id: string }>(`select id from lists`)).map((l) => l.id)
    const errors = validateRules(parsed.data, listIds)
    if (errors.length) return { ok: false as const, error: errors[0] }
    const { sql, params } = compileRules(parsed.data)
    const count = (await db.one<{ n: number }>(`select count(*)::int as n from contacts c where ${sql}`, params))?.n ?? 0
    const sample = await db.query<{ email: string; first_name: string | null }>(`select c.email::text as email, c.first_name from contacts c where ${sql} order by c.last_engaged_at desc nulls last limit 5`, params)
    return { ok: true as const, count, sample }
  })
}

export async function saveSegment(slug: string, input: { id?: string; name: string; description: string; rules: Rules; aiPrompt?: string }): Promise<Ok<{ id: string }> | Err> {
  const ctx = await requireWorkspace(slug)
  const parsed = rulesSchema.safeParse(input.rules)
  if (!parsed.success || !input.name.trim()) return { ok: false, error: "Give the segment a name and at least one valid rule." }
  return withTenant(ctx.workspace.id, async (db) => {
    const listIds = (await db.query<{ id: string }>(`select id from lists`)).map((l) => l.id)
    const errors = validateRules(parsed.data, listIds)
    if (errors.length) return { ok: false as const, error: errors[0] }
    const row = input.id
      ? await db.one<{ id: string }>(`update segments set name = $2, description = $3, rules = $4 where id = $1 returning id`, [input.id, input.name.trim(), input.description, parsed.data])
      : await db.one<{ id: string }>(`insert into segments (name, description, rules, ai_prompt) values ($1,$2,$3,$4) returning id`, [input.name.trim(), input.description, parsed.data, input.aiPrompt ?? null])
    revalidatePath(`/w/${slug}/segments`)
    return { ok: true as const, id: row!.id }
  })
}

export async function deleteSegment(slug: string, id: string) {
  const ctx = await requireWorkspace(slug)
  await withTenant(ctx.workspace.id, (db) => db.query(`delete from segments where id = $1`, [id]))
  revalidatePath(`/w/${slug}/segments`)
}

export async function aiBrandVoice(slug: string, input: { website: string; samples: string }): Promise<Ok<{ voice: BrandVoice }> | Err> {
  const { ctx, run, brand } = await context(slug)
  let websiteText: string | undefined
  if (input.website.trim()) {
    try {
      websiteText = await fetchSiteText(input.website.trim())
    } catch (e) {
      if (!input.samples.trim()) return { ok: false, error: (e as Error).message }
    }
  }
  if (!websiteText && input.samples.trim().length < 80) return { ok: false, error: "Add your website or paste a few samples of your writing (a past email, Instagram captions…)." }
  try {
    const { output } = await extractBrandVoice(run, { businessName: brand.name, industry: ctx.workspace.industry, websiteText, samples: input.samples.slice(0, 6000) })
    await withTenant(ctx.workspace.id, (db) =>
      db.query(`insert into brand_kits (voice, website) values ($1, $2) on conflict (workspace_id) do update set voice = excluded.voice, website = coalesce(brand_kits.website, excluded.website)`,
        [output, input.website.trim() || null]),
    )
    revalidatePath(`/w/${slug}/brand`)
    return { ok: true, voice: output }
  } catch (e) {
    console.error("[aiBrandVoice]", e)
    return { ok: false, error: friendlyAiError(e) }
  }
}

export async function audienceSize(slug: string, audience: { type: "all" } | { type: "list" | "segment"; id: string }) {
  const ctx = await requireWorkspace(slug)
  return withTenant(ctx.workspace.id, (db) => audienceCount(db, audience))
}
