"use server"

import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { hashPassword, requireAdmin } from "@/lib/auth"
import { audit, withAdmin, type Db } from "@/lib/db"

export type ActionState = { ok?: boolean; error?: string; message?: string; tempPassword?: string; href?: string }

const tempPassword = () => randomBytes(9).toString("base64url")

/** Creates the user if new (returning a one-time temp password) and adds the membership. */
async function addMember(db: Db, workspaceId: string, name: string, email: string, role: string) {
  const existing = await db.one<{ id: string }>(`select id from users where email = $1`, [email])
  let password: string | undefined
  let userId = existing?.id
  if (!userId) {
    password = tempPassword()
    userId = (await db.one<{ id: string }>(
      `insert into users (email, name, password_hash) values ($1, $2, $3) returning id`,
      [email, name, await hashPassword(password)],
    ))!.id
  }
  await db.query(
    `insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)
     on conflict (workspace_id, user_id) do update set role = excluded.role`,
    [workspaceId, userId, role],
  )
  return password
}

const tenantSchema = z.object({
  name: z.string().trim().min(2, "Business name is required"),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "Slug: 3-40 lowercase letters, numbers or dashes"),
  industry: z.string().trim().optional(),
  website: z.string().trim().optional(),
  plan: z.enum(["trial", "starter", "growth", "scale"]),
  notes: z.string().trim().optional(),
  ownerName: z.string().trim().min(2, "Owner name is required"),
  ownerEmail: z.string().trim().toLowerCase().email("Owner email is invalid"),
})

export async function createTenant(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin()
  const parsed = tenantSchema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const t = parsed.data
  try {
    return await withAdmin(async (db) => {
      if (await db.one(`select 1 from workspaces where slug = $1`, [t.slug])) return { error: `The slug "${t.slug}" is taken.` }
      const ws = (await db.one<{ id: string }>(
        `insert into workspaces (slug, name, industry, website, plan, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [t.slug, t.name, t.industry || null, t.website || null, t.plan, t.notes || null, admin.id],
      ))!
      await db.query(`insert into brand_kits (workspace_id, display_name, website) values ($1, $2, $3)`, [ws.id, t.name, t.website || null])
      const password = await addMember(db, ws.id, t.ownerName, t.ownerEmail, "owner")
      await audit(db, { workspaceId: ws.id, actorUserId: admin.id, action: "workspace.created", target: t.slug, meta: { plan: t.plan, owner: t.ownerEmail } })
      revalidatePath("/admin")
      return {
        ok: true,
        href: `/admin/tenants/${ws.id}`,
        tempPassword: password,
        message: password
          ? `Workspace created. Share these one-time login details with ${t.ownerEmail}.`
          : `Workspace created. ${t.ownerEmail} already had an account and was added as owner.`,
      }
    })
  } catch (e) {
    console.error(e)
    return { error: "Couldn't create the workspace. Please try again." }
  }
}

export async function addTenantMember(workspaceId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin()
  const parsed = z.object({
    name: z.string().trim().min(2, "Name is required"),
    email: z.string().trim().toLowerCase().email("Email is invalid"),
    role: z.enum(["owner", "admin", "member"]),
  }).safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  return withAdmin(async (db) => {
    const password = await addMember(db, workspaceId, parsed.data.name, parsed.data.email, parsed.data.role)
    await audit(db, { workspaceId, actorUserId: admin.id, action: "member.added", target: parsed.data.email, meta: { role: parsed.data.role } })
    revalidatePath(`/admin/tenants/${workspaceId}`)
    return { ok: true, tempPassword: password, message: password ? `Added. One-time password for ${parsed.data.email}:` : `${parsed.data.email} already had an account and now has access.` }
  })
}

export async function updateTenant(workspaceId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireAdmin()
  const parsed = z.object({
    plan: z.enum(["trial", "starter", "growth", "scale"]),
    status: z.enum(["active", "suspended"]),
    notes: z.string().trim().optional(),
  }).safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  return withAdmin(async (db) => {
    const before = await db.one<{ plan: string; status: string }>(`select plan, status from workspaces where id = $1`, [workspaceId])
    await db.query(`update workspaces set plan = $2, status = $3, notes = $4 where id = $1`, [workspaceId, parsed.data.plan, parsed.data.status, parsed.data.notes || null])
    await audit(db, { workspaceId, actorUserId: admin.id, action: "workspace.updated", meta: { before, after: parsed.data } })
    revalidatePath(`/admin/tenants/${workspaceId}`)
    revalidatePath("/admin")
    return { ok: true, message: "Saved." }
  })
}

export async function removeTenantMember(workspaceId: string, userId: string) {
  const admin = await requireAdmin()
  await withAdmin(async (db) => {
    await db.query(`delete from memberships where workspace_id = $1 and user_id = $2`, [workspaceId, userId])
    await audit(db, { workspaceId, actorUserId: admin.id, action: "member.removed", target: userId })
  })
  revalidatePath(`/admin/tenants/${workspaceId}`)
}
