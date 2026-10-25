import { readToken, recordEvent } from "@/lib/tracking"

// RFC 8058 one-click unsubscribe (mail clients POST here from the List-Unsubscribe header).
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const t = readToken((await params).token)
  if (!t) return new Response("Invalid link", { status: 400 })
  await recordEvent(t, "unsubscribe", { via: "one-click" })
  return new Response("Unsubscribed", { status: 200 })
}

// Humans clicking the footer link get a confirmation page (link scanners can't unsubscribe people).
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return Response.redirect(new URL(`/u/${(await params).token}`, req.url), 303)
}
