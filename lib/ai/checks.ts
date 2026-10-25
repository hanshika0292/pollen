import type { EmailContent } from "@/lib/email/blocks"
import { MERGE_TAGS } from "@/lib/email/render"

export type Check = { id: string; level: "error" | "warn" | "ok"; message: string }

const SPAM_PHRASES = [
  "100% free", "act now", "buy now", "cash bonus", "click here", "double your", "earn money", "free money",
  "guaranteed", "limited time only", "no cost", "no obligation", "once in a lifetime", "risk-free", "winner",
  "you have been selected", "urgent", "!!!", "$$$",
]

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)

/**
 * Rule-based checks that run on every draft, before and alongside the AI
 * critic. They're instant, free and deterministic — the model's judgement is
 * reserved for things rules can't see (clarity, voice, persuasion).
 */
export function runChecks(email: EmailContent, opts: { hasAddress: boolean }): Check[] {
  const out: Check[] = []
  const subject = email.subject.trim()
  const allText = [subject, email.preview_text, ...email.blocks.flatMap((b) => [b.text, ...b.items])].join(" ")
  const bodyWords = email.blocks.flatMap((b) => [b.text, ...b.items]).reduce((n, t) => n + words(t).length, 0)

  if (!subject) out.push({ id: "subject_missing", level: "error", message: "Subject line is empty." })
  else if (subject.length > 70) out.push({ id: "subject_long", level: "warn", message: `Subject is ${subject.length} characters; most inboxes cut off around 60.` })
  else if (subject.length < 15) out.push({ id: "subject_short", level: "warn", message: "Subject is very short; add a specific hook." })
  else out.push({ id: "subject_length", level: "ok", message: "Subject length fits inbox previews." })

  if ((subject.match(/!/g) ?? []).length > 1) out.push({ id: "subject_bang", level: "warn", message: "Multiple exclamation marks in the subject look spammy." })
  if (words(subject).filter((w) => w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w)).length > 1)
    out.push({ id: "subject_caps", level: "warn", message: "Avoid ALL-CAPS words in the subject." })

  if (!email.preview_text.trim()) out.push({ id: "preview_missing", level: "warn", message: "Add preview text — otherwise inboxes show the first line of the body." })

  const hits = SPAM_PHRASES.filter((p) => allText.toLowerCase().includes(p))
  if (hits.length) out.push({ id: "spam_words", level: "warn", message: `Spam-filter trigger phrases: ${hits.map((h) => `"${h}"`).join(", ")}.` })
  else out.push({ id: "spam_words", level: "ok", message: "No common spam-trigger phrases." })

  const ctas = email.blocks.filter((b) => b.type === "cta")
  if (ctas.length === 0) out.push({ id: "cta_missing", level: "warn", message: "No call-to-action button." })
  else if (ctas.length > 2) out.push({ id: "cta_many", level: "warn", message: "More than two buttons dilutes the main action." })
  for (const c of ctas) {
    if (!/^https:\/\/[^\s.]+\.[^\s]+$/.test(c.url)) out.push({ id: "cta_url", level: "error", message: `Button "${c.text || "(no label)"}" needs a valid https:// link.` })
    if (!c.text.trim()) out.push({ id: "cta_label", level: "error", message: "A button has no label." })
  }

  if (bodyWords < 40) out.push({ id: "body_short", level: "warn", message: "Body is under 40 words — may read as thin." })
  else if (bodyWords > 350) out.push({ id: "body_long", level: "warn", message: `Body is ${bodyWords} words; small-business emails convert best under ~250.` })
  else out.push({ id: "body_length", level: "ok", message: `${bodyWords} words — a comfortable read.` })

  const tags = [...allText.matchAll(/\{\{\s*([a-z_.]+)/gi)].map((m) => m[1])
  const bad = tags.filter((t) => !(MERGE_TAGS as readonly string[]).includes(t) && !t.startsWith("attr."))
  if (bad.length) out.push({ id: "merge_tags", level: "error", message: `Unknown personalisation tags: ${[...new Set(bad)].join(", ")}.` })

  if (!opts.hasAddress) out.push({ id: "address", level: "error", message: "Add your business address in Brand Kit — anti-spam laws require it in every email." })

  return out
}

export const hasErrors = (checks: Check[]) => checks.some((c) => c.level === "error")
