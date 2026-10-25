import type { Block } from "./blocks"

export type Brand = {
  name: string
  logo_url?: string | null
  primary_color: string
  accent_color?: string | null
  website?: string | null
  address?: string | null
  footer_text?: string | null
}

export type Recipient = {
  email: string
  first_name?: string | null
  last_name?: string | null
  attributes?: Record<string, unknown> | null
}

export const MERGE_TAGS = ["first_name", "last_name", "email"] as const

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** {{first_name}}, {{first_name|there}}, {{attr.city|your city}} */
export function mergeTags(text: string, r: Recipient | undefined): string {
  return text.replace(/\{\{\s*([a-z_.]+)\s*(?:\|\s*([^}]*))?\}\}/gi, (_m, key: string, fallback?: string) => {
    let value: unknown
    if (r) {
      if (key.startsWith("attr.")) value = r.attributes?.[key.slice(5)]
      else value = (r as Record<string, unknown>)[key]
    }
    const s = value == null || value === "" ? (fallback ?? "").trim() : String(value)
    return s
  })
}

/** Escaped text with **bold** and [label](https://…) support. */
function inline(text: string, color: string, rewrite: (url: string) => string) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) =>
      `<a href="${esc(rewrite(url.replace(/&amp;/g, "&")))}" style="color:${color};text-decoration:underline;">${label}</a>`,
    )
    .replace(/\n/g, "<br>")
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

function renderBlock(b: Block, brand: Brand, rewrite: (url: string) => string, r?: Recipient): string {
  const t = (s: string) => inline(mergeTags(s, r), brand.primary_color, rewrite)
  switch (b.type) {
    case "heading":
      return `<h2 style="margin:0 0 14px;font:700 22px/1.3 ${FONT};color:#111827;">${t(b.text)}</h2>`
    case "paragraph":
      return `<p style="margin:0 0 16px;font:400 16px/1.6 ${FONT};color:#374151;">${t(b.text)}</p>`
    case "bullets":
      return `<ul style="margin:0 0 16px;padding-left:22px;font:400 16px/1.6 ${FONT};color:#374151;">${b.items
        .filter((i) => i.trim())
        .map((i) => `<li style="margin:0 0 6px;">${t(i)}</li>`)
        .join("")}</ul>`
    case "cta":
      if (!b.url.startsWith("http")) return ""
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;"><tr><td style="border-radius:8px;background:${esc(brand.primary_color)};">
<a href="${esc(rewrite(b.url))}" style="display:inline-block;padding:13px 26px;font:600 16px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${t(b.text)}</a>
</td></tr></table>`
    case "divider":
      return `<hr style="border:0;border-top:1px solid #e5e7eb;margin:22px 0;">`
  }
}

export function renderEmail(opts: {
  blocks: Block[]
  previewText?: string | null
  brand: Brand
  recipient?: Recipient
  /** Rewrites links for click tracking; identity when previewing. */
  rewriteLink?: (url: string) => string
  unsubscribeUrl?: string
  openPixelUrl?: string
}): string {
  const { brand, recipient } = opts
  const rewrite = opts.rewriteLink ?? ((u: string) => u)
  const body = opts.blocks.map((b) => renderBlock(b, brand, rewrite, recipient)).join("\n")
  const preview = opts.previewText ? mergeTags(opts.previewText, recipient) : ""

  const header = brand.logo_url
    ? `<img src="${esc(brand.logo_url)}" alt="${esc(brand.name)}" height="40" style="display:block;height:40px;max-width:200px;border:0;">`
    : `<span style="font:800 20px/1 ${FONT};color:${esc(brand.primary_color)};">${esc(brand.name)}</span>`

  const footerLines = [
    brand.footer_text ? esc(brand.footer_text) : `You're receiving this because you're on the ${esc(brand.name)} mailing list.`,
    brand.address ? esc(brand.address) : "",
    opts.unsubscribeUrl
      ? `<a href="${esc(opts.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>`
      : "",
  ].filter(Boolean)

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(brand.name)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="padding:24px 32px;border-bottom:3px solid ${esc(brand.accent_color || brand.primary_color)};">${
    brand.website ? `<a href="${esc(rewrite(brand.website))}" style="text-decoration:none;">${header}</a>` : header
  }</td></tr>
<tr><td style="padding:30px 32px 14px;">${body}</td></tr>
<tr><td style="padding:20px 32px 26px;background:#fafafa;font:400 12px/1.6 ${FONT};color:#6b7280;text-align:center;">${footerLines.join("<br>")}</td></tr>
</table></td></tr></table>${opts.openPixelUrl ? `<img src="${esc(opts.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;">` : ""}
</body></html>`
}
