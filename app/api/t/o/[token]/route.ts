import { readToken, recordEvent } from "@/lib/tracking"

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const t = readToken((await params).token)
  if (t) await recordEvent(t, "open").catch((e) => console.error("[open]", e))
  return new Response(GIF, { headers: { "content-type": "image/gif", "cache-control": "no-store, max-age=0" } })
}
