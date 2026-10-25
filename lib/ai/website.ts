import "server-only"
import { lookup } from "dns/promises"
import { isIP } from "net"
import * as cheerio from "cheerio"

function isPrivate(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:")
  }
  const [a, b] = ip.split(".").map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

/**
 * Fetches a public web page and returns its readable text (for brand-voice
 * extraction). Tenants supply the URL, so private/internal addresses are
 * refused and size/time are capped.
 */
export async function fetchSiteText(rawUrl: string): Promise<string> {
  let url: URL
  try {
    url = new URL(/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
  } catch {
    throw new Error("That doesn't look like a valid website address.")
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) websites are supported.")
  const { address } = await lookup(url.hostname).catch(() => {
    throw new Error("Couldn't find that website.")
  })
  if (isPrivate(address)) throw new Error("That address isn't a public website.")

  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
    headers: { "user-agent": "PollenBot/0.1 (+brand voice setup)", accept: "text/html" },
  }).catch(() => {
    throw new Error("The website didn't respond.")
  })
  if (!res.ok) throw new Error(`The website returned ${res.status}.`)
  const html = (await res.text()).slice(0, 1_500_000)

  const $ = cheerio.load(html)
  $("script,style,noscript,svg,iframe,nav,footer form").remove()
  const parts = [
    $("title").text(),
    $('meta[name="description"]').attr("content") ?? "",
    $('meta[property="og:description"]').attr("content") ?? "",
    ...$("h1,h2,h3,p,li,blockquote")
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((t) => t.length > 25),
  ]
  const text = [...new Set(parts.map((p) => p.trim()).filter(Boolean))].join("\n").slice(0, 9_000)
  if (text.length < 120) throw new Error("Couldn't read enough text from that page. Paste a few writing samples instead.")
  return text
}
