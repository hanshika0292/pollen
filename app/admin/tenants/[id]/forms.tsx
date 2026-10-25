"use client"

import { useActionState, useTransition } from "react"
import { X } from "lucide-react"
import { toast } from "sonner"
import { addTenantMember, removeTenantMember, updateTenant, type ActionState } from "../../actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CredentialNotice } from "@/components/pollen/credential-notice"

const select = "h-9 w-full rounded-md border bg-card px-3 text-sm"

export function TenantSettingsForm({ workspaceId, plan, status, notes }: { workspaceId: string; plan: string; status: string; notes: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateTenant.bind(null, workspaceId), {})
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label htmlFor="plan">Plan</Label>
          <select id="plan" name="plan" defaultValue={plan} className={select}><option value="trial">Trial</option><option value="starter">Starter</option><option value="growth">Growth</option><option value="scale">Scale</option></select></div>
        <div className="space-y-1.5"><Label htmlFor="status">Access</Label>
          <select id="status" name="status" defaultValue={status} className={select}><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="notes">Internal notes</Label><Textarea id="notes" name="notes" defaultValue={notes} rows={3} /></div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {state.message && <span className="text-sm text-success">{state.message}</span>}
        {state.error && <span className="text-sm text-destructive">{state.error}</span>}
      </div>
    </form>
  )
}

export function AddMemberForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addTenantMember.bind(null, workspaceId), {})
  return (
    <form action={action} className="space-y-3 rounded-lg bg-muted/40 p-4">
      <p className="text-sm font-medium">Add someone</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_110px]">
        <Input name="name" placeholder="Name" required aria-label="Name" />
        <Input name="email" type="email" placeholder="Email" required aria-label="Email" />
        <select name="role" defaultValue="member" className={select} aria-label="Role"><option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option></select>
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Adding…" : "Add to workspace"}</Button>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && (state.tempPassword ? <CredentialNotice password={state.tempPassword} /> : <p className="text-sm text-success">{state.message}</p>)}
    </form>
  )
}

export function RemoveMemberButton({ workspaceId, userId, name }: { workspaceId: string; userId: string; name: string }) {
  const [pending, start] = useTransition()
  return (
    <button
      disabled={pending}
      title={`Remove ${name}`}
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
      onClick={() => { if (confirm(`Remove ${name} from this workspace?`)) start(async () => { await removeTenantMember(workspaceId, userId); toast.success("Removed") }) }}
    >
      <X className="size-4" />
    </button>
  )
}
