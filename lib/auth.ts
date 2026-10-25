import "server-only"
import type { NextAuthOptions } from "next-auth"
import { getServerSession } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { notFound, redirect } from "next/navigation"
import { cache } from "react"
import { withGlobal } from "./db"

declare module "next-auth" {
  interface Session {
    user: { id: string; email: string; name: string; isPlatformAdmin: boolean }
  }
  interface User {
    id: string
    email: string
    name: string
    isPlatformAdmin: boolean
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    uid?: string
    isPlatformAdmin?: boolean
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password
        if (!email || !password) return null
        const user = await withGlobal((db) =>
          db.one<{ id: string; email: string; name: string; password_hash: string; is_platform_admin: boolean }>(
            `select id, email, name, password_hash, is_platform_admin from users where email = $1`,
            [email],
          ),
        )
        // Same response for unknown email and wrong password: no account probing.
        if (!user || !(await bcrypt.compare(password, user.password_hash))) return null
        await withGlobal((db) => db.query(`update users set last_login_at = now() where id = $1`, [user.id]))
        return { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.is_platform_admin }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id
        token.isPlatformAdmin = user.isPlatformAdmin
      }
      return token
    },
    session({ session, token }) {
      session.user = {
        id: token.uid!,
        email: token.email!,
        name: token.name ?? "",
        isPlatformAdmin: !!token.isPlatformAdmin,
      }
      return session
    },
  },
}

export type SessionUser = { id: string; email: string; name: string; isPlatformAdmin: boolean }

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getServerSession(authOptions)
  return session?.user?.id ? session.user : null
})

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser()
  if (!user) redirect("/login")
  return user
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (!user.isPlatformAdmin) notFound()
  return user
}

export type Role = "owner" | "admin" | "member"
export type WorkspaceCtx = {
  user: SessionUser
  role: Role
  /** True when a platform admin is viewing a workspace they aren't a member of. */
  viaAdmin: boolean
  workspace: { id: string; slug: string; name: string; plan: string; status: string; is_demo: boolean; website: string | null; industry: string | null }
}

/**
 * Resolves the workspace for a request and checks the caller may use it.
 * Every tenant page and server action goes through here.
 */
export const requireWorkspace = cache(async (slug: string): Promise<WorkspaceCtx> => {
  const user = await requireUser()
  const row = await withGlobal((db) =>
    db.one<WorkspaceCtx["workspace"] & { role: Role | null }>(
      `select w.id, w.slug, w.name, w.plan, w.status, w.is_demo, w.website, w.industry, m.role
         from workspaces w
         left join memberships m on m.workspace_id = w.id and m.user_id = $2
        where w.slug = $1`,
      [slug, user.id],
    ),
  )
  if (!row) notFound()
  const { role, ...workspace } = row
  if (role) {
    if (workspace.status === "suspended" && !user.isPlatformAdmin) redirect("/suspended")
    return { user, role, workspace, viaAdmin: false }
  }
  if (user.isPlatformAdmin) return { user, role: "owner", workspace, viaAdmin: true }
  notFound()
})

export function canManage(ctx: WorkspaceCtx) {
  return ctx.role === "owner" || ctx.role === "admin"
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}
