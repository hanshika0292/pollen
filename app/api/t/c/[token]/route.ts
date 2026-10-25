import { readToken, recordEvent } from "@/lib/tracking"

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const t = readToken((await params).token)
  // The destination is inside the signed token, so this can't be used as an open redirect.
  if (!t?.u || !/^https?:\/\//.test(t.u)) return new Response("Link expired or invalid", { status: 404 })
  await recordEvent(t, "click", { url: t.u }).catch((e) => console.error("[click]", e))
  return Response.redirect(t.u, 302)
}
