import { redirect } from "next/navigation"
import { getUser } from "@/lib/auth"
import { withGlobal } from "@/lib/db"

export default async function Home() {
  const user = await getUser()
  if (!user) redirect("/login")
  if (user.isPlatformAdmin) redirect("/admin")
  const ws = await withGlobal((db) =>
    db.one<{ slug: string }>(
      `select w.slug from memberships m join workspaces w on w.id = m.workspace_id
        where m.user_id = $1 order by m.created_at limit 1`,
      [user.id],
    ),
  )
  if (!ws) redirect("/login?error=NoWorkspace")
  redirect(`/w/${ws.slug}`)
}
