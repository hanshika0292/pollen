import { withAdmin } from "@/lib/db"
import { PageHeader } from "@/components/pollen/ui"

export const metadata = { title: "Audit log" }

export default async function AuditPage() {
  const rows = await withAdmin((db) =>
    db.query<{ id: number; action: string; target: string | null; meta: object; created_at: string; actor: string | null; workspace: string | null }>(`
      select a.id, a.action, a.target, a.meta, a.created_at, u.email::text as actor, w.name as workspace
        from audit_log a left join users u on u.id = a.actor_user_id left join workspaces w on w.id = a.workspace_id
       order by a.created_at desc limit 200`),
  )
  return (
    <>
      <PageHeader title="Audit log" description="Admin and account actions across all tenants, newest first." />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-4 py-3 font-medium">When</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Workspace</th><th className="px-4 py-3 font-medium">By</th><th className="px-4 py-3 font-medium">Details</th></tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2.5">{r.workspace ?? "—"}</td>
                <td className="px-4 py-2.5">{r.actor ?? "system"}</td>
                <td className="max-w-xs truncate px-4 py-2.5 text-xs text-muted-foreground">{r.target}{Object.keys(r.meta ?? {}).length ? ` ${JSON.stringify(r.meta)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
