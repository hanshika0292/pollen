import "server-only"
import { verifyToken } from "./crypto"
import { withTenant } from "./db"

export type LinkToken = { w: string; c: string; k: string; u?: string }

export function readToken(token: string) {
  const t = verifyToken<LinkToken>(token)
  if (!t || !/^[0-9a-f-]{36}$/.test(t.w) || !/^[0-9a-f-]{36}$/.test(t.c) || !/^[0-9a-f-]{36}$/.test(t.k)) return null
  return t
}

export async function recordEvent(t: LinkToken, type: "open" | "click" | "unsubscribe", meta: object = {}) {
  await withTenant(t.w, async (db) => {
    // Contact/campaign must exist in this tenant (RLS makes other tenants invisible).
    const ok = await db.one(`select 1 from contacts where id = $1`, [t.k])
    if (!ok) return
    if (type === "click") {
      // A click implies an open (images are often blocked).
      await db.query(`insert into email_events (campaign_id, contact_id, type) values ($1,$2,'open') on conflict do nothing`, [t.c, t.k])
      await db.query(`insert into email_events (campaign_id, contact_id, type, meta) values ($1,$2,'click',$3)`, [t.c, t.k, meta])
    } else {
      await db.query(`insert into email_events (campaign_id, contact_id, type, meta) values ($1,$2,$3,$4) on conflict do nothing`, [t.c, t.k, type, meta])
    }
    if (type === "unsubscribe") await db.query(`update contacts set status = 'unsubscribed' where id = $1 and status = 'subscribed'`, [t.k])
    else await db.query(`update contacts set last_engaged_at = now() where id = $1`, [t.k])
  })
}
