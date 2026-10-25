"use client"

import { useActionState, useEffect, useRef, useTransition } from "react"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { createList, deleteList, type Result } from "@/lib/actions/contacts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Panel } from "@/components/pollen/ui"

export function CreateListForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<Result, FormData>(createList.bind(null, slug), {})
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state.ok) { toast.success(state.message); ref.current?.reset() } }, [state])
  return (
    <Panel title="New list" className="h-fit">
      <form ref={ref} action={action} className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" name="name" required placeholder="e.g. Diwali hamper buyers" /></div>
        <div className="space-y-1.5"><Label htmlFor="description">Description</Label><Input id="description" name="description" placeholder="Optional" /></div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" disabled={pending} className="w-full">Create list</Button>
      </form>
    </Panel>
  )
}

export function DeleteListButton({ slug, id, name }: { slug: string; id: string; name: string }) {
  const [pending, start] = useTransition()
  return (
    <button disabled={pending} aria-label={`Delete ${name}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
      onClick={() => { if (confirm(`Delete the list "${name}"? Contacts stay in your workspace.`)) start(() => deleteList(slug, id)) }}>
      <Trash2 className="size-4" />
    </button>
  )
}
