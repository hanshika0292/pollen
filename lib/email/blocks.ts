import { z } from "zod"

/**
 * Email bodies are stored as blocks, not free HTML. The AI writes blocks, the
 * editor edits blocks, and one renderer turns them into email-client-safe
 * HTML — so AI output can never break layout or inject markup.
 *
 * The block shape is deliberately flat (every field always present) because
 * that is the structured-output form all three BYOK providers handle reliably.
 */
export const BLOCK_TYPES = ["heading", "paragraph", "bullets", "cta", "divider"] as const

export const blockSchema = z.object({
  type: z.enum(BLOCK_TYPES),
  text: z.string().describe("heading/paragraph text, or the CTA button label. Empty for bullets/divider."),
  items: z.array(z.string()).describe("bullet points; empty array unless type is bullets"),
  url: z.string().describe("CTA destination URL; empty string unless type is cta"),
})
export type Block = z.infer<typeof blockSchema>

export const emailContentSchema = z.object({
  subject: z.string(),
  preview_text: z.string(),
  blocks: z.array(blockSchema),
})
export type EmailContent = z.infer<typeof emailContentSchema>

export function emptyBlock(type: Block["type"]): Block {
  return { type, text: "", items: type === "bullets" ? [""] : [], url: type === "cta" ? "https://" : "" }
}

export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
        case "paragraph":
          return b.text
        case "bullets":
          return b.items.map((i) => `• ${i}`).join("\n")
        case "cta":
          return `[${b.text}](${b.url})`
        case "divider":
          return "---"
      }
    })
    .join("\n\n")
}
