import { requireAdmin } from "@/lib/auth"
import { Shell } from "@/components/pollen/shell"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin()
  return (
    <Shell
      title="Pollen HQ"
      subtitle="Platform admin"
      user={user}
      nav={[
        { href: "/admin", label: "Tenants", icon: "Building2", exact: true },
        { href: "/admin/audit", label: "Audit log", icon: "ScrollText" },
      ]}
    >
      {children}
    </Shell>
  )
}
