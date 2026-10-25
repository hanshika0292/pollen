"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireWorkspace } from "@/lib/auth"
import { withTenant } from "@/lib/db"

export type Result = { ok?: boolean; error?: string; message?: string }

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)
const normTags = (s: string) => [...new Set(s.split(/[,;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean))]

export async function addContact(slug: string, _: Result, form: FormData): Promise<Result> {
  const ctx = await requireWorkspace(slug)
  const parsed = z.object({
    email: z.string().trim().toLowerCase().refine(emailOk, "Enter a valid email"),
    first_name: z.string().trim().optional(),
    last_name: z.string().trim().optional(),
    tags: z.string().optional(),
  }).safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const c = parsed.data
  const inserted = await withTenant(ctx.workspace.id, (db) =>
    db.one(
      `insert into contacts (email, first_name, last_name, tags, source) values ($1,$2,$3,$4,'manual')
       on conflict (workspace_id, email) do nothing returning id`,
      [c.email, c.first_name || null, c.last_name || null, normTags(c.tags ?? "")],
    ),
  )
  if (!inserted) return { error: "That email is already in your contacts." }
  revalidatePath(`/w/${slug}/contacts`)
  return { ok: true, message: `Added ${c.email}` }
}

/** Minimal RFC-4180-ish CSV parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") { row.push(field); field = "" }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field); rows.push(row); row = []; field = ""
    } else field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f.trim()))
}

const HEADER_ALIASES: Record<string, string> = {
  email: "email", "e-mail": "email", "email address": "email",
  first_name: "first_name", firstname: "first_name", "first name": "first_name", name: "first_name",
  last_name: "last_name", lastname: "last_name", "last name": "last_name", surname: "last_name",
  phone: "phone", mobile: "phone", "phone number": "phone", tags: "tags", tag: "tags",
}

export async function importContacts(slug: string, csv: string, listId: string | null): Promise<Result & { imported?: number; skipped?: number; updated?: number }> {
  const ctx = await requireWorkspace(slug)
  if (csv.length > 5_000_000) return { error: "That file is over 5 MB. Split it and import in parts." }
  const rows = parseCsv(csv)
  if (rows.length < 2) return { error: "The file needs a header row and at least one contact." }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const map = header.map((h) => HEADER_ALIASES[h] ?? `attr:${h.replace(/[^a-z0-9_]+/g, "_")}`)
  if (!map.includes("email")) return { error: "Couldn't find an email column. Name it \"email\"." }
  if (rows.length > 20_001) return { error: "Imports are limited to 20,000 rows for now." }

  let skipped = 0
  const records = new Map<string, { email: string; first_name: string | null; last_name: string | null; phone: string | null; tags: string[]; attributes: Record<string, string> }>()
  for (const r of rows.slice(1)) {
    const rec = { email: "", first_name: null as string | null, last_name: null as string | null, phone: null as string | null, tags: [] as string[], attributes: {} as Record<string, string> }
    map.forEach((key, i) => {
      const v = (r[i] ?? "").trim()
      if (!v) return
      if (key === "email") rec.email = v.toLowerCase()
      else if (key === "tags") rec.tags = normTags(v)
      else if (key.startsWith("attr:")) { if (key.length > 5) rec.attributes[key.slice(5)] = v }
      else (rec as Record<string, unknown>)[key] = v
    })
    if (!emailOk(rec.email)) { skipped++; continue }
    records.set(rec.email, rec)
  }
  const list = [...records.values()]

  const result = await withTenant(ctx.workspace.id, async (db) => {
    let imported = 0
    let updated = 0
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500)
      // Existing contacts keep their status (never re-subscribe someone by import); tags merge, fields fill gaps.
      const rows = await db.query<{ id: string; inserted: boolean }>(
        `insert into contacts (email, first_name, last_name, phone, tags, attributes, source)
         select x.email, x.first_name, x.last_name, x.phone, x.tags, x.attributes, 'import'
           from jsonb_to_recordset($1::jsonb) as x(email text, first_name text, last_name text, phone text, tags text[], attributes jsonb)
         on conflict (workspace_id, email) do update set
           first_name = coalesce(contacts.first_name, excluded.first_name),
           last_name  = coalesce(contacts.last_name, excluded.last_name),
           phone      = coalesce(contacts.phone, excluded.phone),
           tags       = (select array(select distinct unnest(contacts.tags || excluded.tags))),
           attributes = excluded.attributes || contacts.attributes
         returning id, (xmax = 0) as inserted`,
        [JSON.stringify(chunk)],
      )
      imported += rows.filter((r) => r.inserted).length
      updated += rows.filter((r) => !r.inserted).length
      if (listId)
        await db.query(`insert into list_members (list_id, contact_id) select $1, unnest($2::uuid[]) on conflict do nothing`, [listId, rows.map((r) => r.id)])
    }
    return { imported, updated }
  })
  revalidatePath(`/w/${slug}/contacts`)
  revalidatePath(`/w/${slug}/lists`)
  return { ok: true, ...result, skipped }
}

export async function setContactStatus(slug: string, id: string, status: "subscribed" | "unsubscribed") {
  const ctx = await requireWorkspace(slug)
  await withTenant(ctx.workspace.id, (db) => db.query(`update contacts set status = $2 where id = $1`, [id, status]))
  revalidatePath(`/w/${slug}/contacts`)
}

export async function deleteContact(slug: string, id: string) {
  const ctx = await requireWorkspace(slug)
  await withTenant(ctx.workspace.id, (db) => db.query(`delete from contacts where id = $1`, [id]))
  revalidatePath(`/w/${slug}/contacts`)
}

export async function createList(slug: string, _: Result, form: FormData): Promise<Result> {
  const ctx = await requireWorkspace(slug)
  const name = String(form.get("name") ?? "").trim()
  if (!name) return { error: "Give the list a name." }
  await withTenant(ctx.workspace.id, (db) =>
    db.query(`insert into lists (name, description) values ($1, $2)`, [name, String(form.get("description") ?? "").trim() || null]),
  )
  revalidatePath(`/w/${slug}/lists`)
  return { ok: true, message: `Created "${name}"` }
}

export async function deleteList(slug: string, id: string) {
  const ctx = await requireWorkspace(slug)
  await withTenant(ctx.workspace.id, (db) => db.query(`delete from lists where id = $1`, [id]))
  revalidatePath(`/w/${slug}/lists`)
}
