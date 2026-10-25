import "server-only"
import { z } from "zod"
import { runObject, type RunContext } from "./core"
import { runChecks, type Check } from "./checks"
import { emailContentSchema, blockSchema, blocksToText, type EmailContent } from "@/lib/email/blocks"
import { rulesSchema, validateRules, type Rules } from "@/lib/segments"

// ─── Brand voice ─────────────────────────────────────────────────────────────

export const brandVoiceSchema = z.object({
  summary: z.string().describe("Two sentences: who the business is and how it sounds."),
  audience: z.string().describe("Who they're talking to, specifically."),
  tone: z.array(z.string()).describe("3-5 tone adjectives"),
  formality: z.enum(["casual", "conversational", "professional", "formal"]),
  emoji: z.enum(["none", "light", "expressive"]),
  do: z.array(z.string()).describe("3-6 concrete writing habits to follow"),
  dont: z.array(z.string()).describe("3-6 things this brand would never say or do"),
  preferred_words: z.array(z.string()),
  avoid_words: z.array(z.string()),
  sample_phrases: z.array(z.string()).describe("3-5 short lines that sound exactly like this brand"),
})
export type BrandVoice = z.infer<typeof brandVoiceSchema>

export async function extractBrandVoice(
  ctx: RunContext,
  input: { businessName: string; industry?: string | null; websiteText?: string; samples?: string },
) {
  return runObject(ctx, {
    feature: "brand_voice",
    tier: "quality",
    schema: brandVoiceSchema,
    temperature: 0.3,
    system:
      "You are a brand strategist for small businesses. Infer a practical, specific brand voice guide from the material provided. " +
      "Base every point on evidence in the material; never invent products, prices or claims. Be concrete: 'Uses short sentences and " +
      "names specific dishes' beats 'engaging'.",
    prompt: [
      `Business: ${input.businessName}${input.industry ? ` (${input.industry})` : ""}`,
      input.websiteText ? `\nWebsite content:\n${input.websiteText}` : "",
      input.samples ? `\nWriting samples from the business:\n${input.samples}` : "",
    ].join("\n"),
  })
}

export function voiceBrief(v: BrandVoice | null | undefined): string {
  if (!v) return "No brand voice guide yet: write in a warm, clear, conversational small-business voice."
  return [
    `Voice: ${v.summary}`,
    `Audience: ${v.audience}`,
    `Tone: ${v.tone.join(", ")}; ${v.formality}; emoji use: ${v.emoji}.`,
    `Do: ${v.do.join("; ")}`,
    `Don't: ${v.dont.join("; ")}`,
    v.preferred_words.length ? `Prefer words: ${v.preferred_words.join(", ")}` : "",
    v.avoid_words.length ? `Avoid words: ${v.avoid_words.join(", ")}` : "",
    v.sample_phrases.length ? `Sounds like: ${v.sample_phrases.map((s) => `"${s}"`).join(" / ")}` : "",
  ].filter(Boolean).join("\n")
}

// ─── Compose with quality gate ───────────────────────────────────────────────

const composeSchema = z.object({
  subject_options: z.array(z.object({ text: z.string(), angle: z.string().describe("e.g. benefit, curiosity, timely, personal") })).describe("exactly 3 distinct subject lines"),
  preview_text: z.string(),
  blocks: z.array(blockSchema),
})

const critiqueSchema = z.object({
  scores: z.object({
    clarity: z.number().describe("1-10: is the point and the ask obvious in 5 seconds?"),
    voice_match: z.number().describe("1-10: does it sound like the brand voice guide?"),
    relevance: z.number().describe("1-10: does it serve the stated goal and audience?"),
    cta_strength: z.number().describe("1-10: is there one compelling, specific next step?"),
    skimmability: z.number().describe("1-10: short paragraphs, scannable structure, mobile friendly"),
  }),
  best_subject_index: z.number().describe("0-based index of the strongest subject option"),
  issues: z.array(z.object({
    severity: z.enum(["high", "medium", "low"]),
    issue: z.string(),
    fix: z.string().describe("specific instruction to fix it"),
  })),
  strengths: z.array(z.string()),
})
type Critique = z.infer<typeof critiqueSchema>

export type Scorecard = {
  overall: number
  scores: Critique["scores"]
  issues: Critique["issues"]
  strengths: string[]
  checks: Check[]
  passes: number
  subject_options: { text: string; angle: string }[]
  model: string
  critic_model: string
  generated_at: string
}

const PASS_MARK = 8
const WRITER_RULES = `Rules:
- Output email content as blocks. Use: an optional heading, 2-4 short paragraphs (1-3 sentences each), optional bullets, exactly ONE cta block, optional sign-off paragraph.
- Open with a greeting using the merge tag {{first_name|there}} (e.g. "Hi {{first_name|there}},"). The only merge tags allowed are {{first_name|…}}, {{last_name}}, {{email}}.
- Never invent facts, prices, dates, discounts or claims that aren't in the brief. If a detail is missing, write around it.
- Subject lines: under 55 characters, no ALL CAPS, at most one "!", no spam phrases (free!!!, act now, guaranteed, winner...).
- Preview text: 40-90 characters, complements the subject rather than repeating it.
- The cta url must be the exact URL provided; if none is given use the business website.
- You may use **bold** sparingly and [label](https://url) links inside paragraphs.`

function brandContext(b: { businessName: string; industry?: string | null; website?: string | null; voice?: BrandVoice | null }) {
  return `Business: ${b.businessName}${b.industry ? ` — ${b.industry}` : ""}${b.website ? `\nWebsite: ${b.website}` : ""}\n\nBrand voice guide:\n${voiceBrief(b.voice)}`
}

function overallOf(c: Critique) {
  const s = Object.values(c.scores).map((n) => Math.max(1, Math.min(10, n)))
  return Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10
}

async function critique(ctx: RunContext, brand: Parameters<typeof brandContext>[0], goal: string, draft: z.infer<typeof composeSchema>) {
  return runObject(ctx, {
    feature: "critique",
    tier: "fast",
    schema: critiqueSchema,
    temperature: 0,
    qualityScore: overallOf,
    system:
      "You are a demanding email marketing editor. Score the draft honestly against the rubric; 8+ means ready to send to real customers. " +
      "List concrete issues with specific fixes. Don't reward length. Penalise invented facts, vague CTAs, walls of text, and anything off-voice.",
    prompt: `${brandContext(brand)}\n\nCampaign goal: ${goal}\n\nSubject options:\n${draft.subject_options.map((s, i) => `${i}. ${s.text} (${s.angle})`).join("\n")}\nPreview text: ${draft.preview_text}\n\nBody:\n${blocksToText(draft.blocks)}`,
  })
}

export type ComposeInput = {
  goal: string
  brief: string
  ctaUrl?: string
  length: "short" | "medium" | "long"
  businessName: string
  industry?: string | null
  website?: string | null
  voice?: BrandVoice | null
  hasAddress: boolean
}

/**
 * Draft → rule checks + AI critic → (if below the bar) one targeted revision
 * → re-score. The user gets the best version plus a scorecard explaining it.
 */
export async function composeEmail(ctx: RunContext, input: ComposeInput): Promise<{ content: EmailContent; scorecard: Scorecard }> {
  const brand = { businessName: input.businessName, industry: input.industry, website: input.website, voice: input.voice }
  const lengthHint = { short: "60-110 words", medium: "110-180 words", long: "180-260 words" }[input.length]

  const draft = await runObject(ctx, {
    feature: "compose",
    tier: "quality",
    schema: composeSchema,
    temperature: 0.7,
    system: `You are a senior email copywriter for small businesses.\n${WRITER_RULES}`,
    prompt: `${brandContext(brand)}\n\nCampaign goal: ${input.goal}\nBrief: ${input.brief}\nCTA URL: ${input.ctaUrl || input.website || "(none — omit link text that promises a page)"}\nBody length: ${lengthHint}`,
  })

  let current = draft.output
  let review = await critique(ctx, brand, input.goal, current)
  let passes = 1

  const toContent = (d: typeof current, c: Critique): EmailContent => ({
    subject: d.subject_options[Math.min(Math.max(0, Math.round(c.best_subject_index)), d.subject_options.length - 1)]?.text ?? "",
    preview_text: d.preview_text,
    blocks: d.blocks,
  })
  let checks = runChecks(toContent(current, review.output), { hasAddress: input.hasAddress })
  const contentErrors = (cs: Check[]) => cs.filter((c) => c.level !== "ok" && c.id !== "address")

  if (overallOf(review.output) < PASS_MARK || contentErrors(checks).some((c) => c.level === "error")) {
    const fixes = [
      ...review.output.issues.filter((i) => i.severity !== "low").map((i) => `- ${i.issue} → ${i.fix}`),
      ...contentErrors(checks).map((c) => `- ${c.message}`),
    ].join("\n")
    const revised = await runObject(ctx, {
      feature: "revise",
      tier: "quality",
      schema: composeSchema,
      temperature: 0.5,
      system: `You are a senior email copywriter revising a draft after an editor's review. Fix every listed issue; keep what works.\n${WRITER_RULES}`,
      prompt: `${brandContext(brand)}\n\nCampaign goal: ${input.goal}\nBrief: ${input.brief}\nCTA URL: ${input.ctaUrl || input.website || ""}\nBody length: ${lengthHint}\n\nCurrent draft:\nSubjects: ${current.subject_options.map((s) => s.text).join(" | ")}\nPreview: ${current.preview_text}\n${blocksToText(current.blocks)}\n\nEditor's required fixes:\n${fixes}`,
    })
    const reReview = await critique(ctx, brand, input.goal, revised.output)
    passes = 2
    // Keep whichever version actually scored better — a revision isn't automatically an improvement.
    if (overallOf(reReview.output) >= overallOf(review.output)) {
      current = revised.output
      review = reReview
    }
    checks = runChecks(toContent(current, review.output), { hasAddress: input.hasAddress })
  }

  return {
    content: toContent(current, review.output),
    scorecard: {
      overall: overallOf(review.output),
      scores: review.output.scores,
      issues: review.output.issues,
      strengths: review.output.strengths,
      checks,
      passes,
      subject_options: current.subject_options,
      model: draft.model,
      critic_model: review.model,
      generated_at: new Date().toISOString(),
    },
  }
}

/** Score an existing (e.g. hand-edited) email without rewriting it. */
export async function scoreEmail(ctx: RunContext, input: Omit<ComposeInput, "brief" | "length" | "ctaUrl"> & { content: EmailContent }): Promise<Scorecard> {
  const brand = { businessName: input.businessName, industry: input.industry, website: input.website, voice: input.voice }
  const draft = { subject_options: [{ text: input.content.subject, angle: "current" }], preview_text: input.content.preview_text, blocks: input.content.blocks }
  const review = await critique(ctx, brand, input.goal, draft)
  return {
    overall: overallOf(review.output),
    scores: review.output.scores,
    issues: review.output.issues,
    strengths: review.output.strengths,
    checks: runChecks(input.content, { hasAddress: input.hasAddress }),
    passes: 0,
    subject_options: draft.subject_options,
    model: "—",
    critic_model: review.model,
    generated_at: new Date().toISOString(),
  }
}

// ─── Rewrite ─────────────────────────────────────────────────────────────────

export const REWRITES = {
  shorter: "Cut the length by about 40% while keeping the key message and CTA.",
  friendlier: "Make it warmer and more personal, like a note from the owner.",
  punchier: "Make it more energetic and direct: stronger verbs, tighter sentences.",
  professional: "Make it more polished and professional without becoming stiff.",
  hindi: "Translate to natural, conversational Hindi (Devanagari). Keep merge tags, URLs and brand names unchanged.",
  hinglish: "Rewrite in natural Hinglish (Hindi-English mix in Latin script) as used in Indian marketing. Keep merge tags and URLs unchanged.",
} as const
export type RewriteKind = keyof typeof REWRITES

export async function rewriteEmail(
  ctx: RunContext,
  input: { content: EmailContent; kind: RewriteKind; businessName: string; industry?: string | null; website?: string | null; voice?: BrandVoice | null },
) {
  return runObject(ctx, {
    feature: "rewrite",
    tier: "quality",
    schema: emailContentSchema,
    temperature: 0.5,
    system: `You are a senior email copywriter. Rewrite the email as instructed, staying within the brand voice.\n${WRITER_RULES}\nKeep every CTA url exactly as given.`,
    prompt: `${brandContext(input)}\n\nInstruction: ${REWRITES[input.kind]}\n\nEmail:\nSubject: ${input.content.subject}\nPreview: ${input.content.preview_text}\n\n${blocksToText(input.content.blocks)}`,
  })
}

// ─── Segment builder ─────────────────────────────────────────────────────────

const segmentDraftSchema = z.object({
  name: z.string(),
  description: z.string(),
  rules: rulesSchema,
  assumptions: z.array(z.string()).describe("Interpretations you made that the user should confirm"),
})

const SEGMENT_GUIDE = `Available conditions (field → ops → value):
- status → is | is_not → subscribed | unsubscribed | bounced | complained
- tag → has | not_has → tag text (lowercase)
- source → is | is_not → manual | import | api | form
- email_domain → is | is_not → e.g. gmail.com
- attribute → is | is_not | contains | exists → "key=value" (or just "key" for exists)
- list → in | not_in → a list id from the provided lists
- joined_days → within | older_than → number of days
- engaged_days → within | older_than | never → number of days ("never" ignores value; use "0")
- opened_days → yes | no → number of days (opened any email in that window)
- clicked_days → yes | no → number of days
All values are strings. Only use tags, attribute keys and lists that exist in the workspace data below.
Unless the user explicitly asks about unsubscribed people, include status is subscribed.`

export async function buildSegment(
  ctx: RunContext,
  input: { request: string; lists: { id: string; name: string }[]; tags: string[]; attributeKeys: string[]; sources: string[] },
): Promise<{ name: string; description: string; rules: Rules; assumptions: string[] }> {
  const workspaceData = `Lists: ${input.lists.map((l) => `${l.name} (id ${l.id})`).join("; ") || "none"}\nTags in use: ${input.tags.join(", ") || "none"}\nCustom fields: ${input.attributeKeys.join(", ") || "none"}\nSources: ${input.sources.join(", ") || "manual"}`
  let prompt = `${SEGMENT_GUIDE}\n\nWorkspace data:\n${workspaceData}\n\nRequest: ${input.request}`
  const listIds = input.lists.map((l) => l.id)

  // Self-repair: if the model's rules don't validate, feed the errors back once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { output } = await runObject(ctx, {
      feature: "segment",
      tier: "fast",
      schema: segmentDraftSchema,
      temperature: 0,
      system: "You translate plain-English audience descriptions into segment rules for an email marketing tool. Use the fewest conditions that capture the intent.",
      prompt,
    })
    const errors = validateRules(output.rules, listIds)
    if (errors.length === 0) return output
    prompt += `\n\nYour previous answer had these problems, fix them:\n${errors.map((e) => `- ${e}`).join("\n")}\nPrevious rules: ${JSON.stringify(output.rules)}`
  }
  throw new Error("Couldn't turn that into a valid segment. Try rephrasing, or build it with the rule editor.")
}

// ─── WhatsApp reply drafting ───────────────────────────────────────────────────

const waReplySchema = z.object({ reply: z.string().describe("The WhatsApp reply message, ready to send.") })

/** Draft a short, on-brand WhatsApp reply to an inbound customer message. */
export async function draftWaReply(
  ctx: RunContext,
  input: { message: string; businessName: string; voice?: BrandVoice | null; history?: string },
): Promise<string> {
  const { output } = await runObject(ctx, {
    feature: "wa_reply",
    tier: "fast",
    schema: waReplySchema,
    temperature: 0.5,
    system:
      `You are handling WhatsApp for ${input.businessName}. Reply as the business, briefly and warmly (WhatsApp style: 1-3 short sentences, no email formatting, no subject line). ` +
      `Answer what was asked; if you don't know a specific fact (price, timing, stock), say you'll check rather than inventing it.\n\n${voiceBrief(input.voice)}`,
    prompt: `${input.history ? `Recent conversation:\n${input.history}\n\n` : ""}Customer's latest message: "${input.message}"\n\nWrite the reply.`,
  })
  return output.reply.trim()
}
