"use client"

import { useActionState, useEffect, useRef, useState, useTransition } from "react"
import { MoreHorizontal, Plus, Upload } from "lucide-react"
import { toast } from "sonner"
import { addContact, deleteContact, importContacts, setContactStatus, type Result } from "@/lib/actions/contacts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export function AddContactDialog({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<Result, FormData>(addContact.bind(null, slug), {})
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state.ok) { toast.success(state.message); formRef.current?.reset(); setOpen(false) }
  }, [state])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> Add contact</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add a contact</DialogTitle><DialogDescription>Only add people who've agreed to hear from you.</DialogDescription></DialogHeader>
        <form ref={formRef} action={action} className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="first_name">First name</Label><Input id="first_name" name="first_name" /></div>
            <div className="space-y-1.5"><Label htmlFor="last_name">Last name</Label><Input id="last_name" name="last_name" /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="tags">Tags</Label><Input id="tags" name="tags" placeholder="regular, coffee-club" /></div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <Button type="submit" disabled={pending} className="w-full">{pending ? "Adding…" : "Add contact"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ImportDialog({ slug, lists }: { slug: string; lists: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [listId, setListId] = useState("")
  const [pending, start] = useTransition()
  const [error, setError] = useState("")

  function run() {
    if (!file) return
    setError("")
    start(async () => {
      const text = await file.text()
      const r = await importContacts(slug, text, listId || null)
      if (r.error) return setError(r.error)
      toast.success(`Imported ${r.imported} new · updated ${r.updated}${r.skipped ? ` · skipped ${r.skipped} invalid` : ""}`)
      setOpen(false)
      setFile(null)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Upload /> Import CSV</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>CSV with an <code>email</code> column. Optional: first_name, last_name, phone, tags (comma-separated). Any other column becomes a custom field.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center text-sm hover:bg-muted/50">
            <Upload className="size-5 text-muted-foreground" />
            {file ? <span className="font-medium">{file.name}</span> : <span className="text-muted-foreground">Choose a .csv file</span>}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="list">Also add to list (optional)</Label>
            <select id="list" value={listId} onChange={(e) => setListId(e.target.value)} className="h-9 w-full rounded-md border bg-card px-3 text-sm">
              <option value="">Don't add to a list</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={run} disabled={!file || pending} className="w-full">{pending ? "Importing…" : "Import"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ContactRowActions({ slug, id, status, email }: { slug: string; id: string; status: string; email: string }) {
  const [, start] = useTransition()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={`Actions for ${email}`}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {status === "subscribed" ? (
          <DropdownMenuItem onClick={() => start(() => setContactStatus(slug, id, "unsubscribed"))}>Mark unsubscribed</DropdownMenuItem>
        ) : status === "unsubscribed" ? (
          <DropdownMenuItem onClick={() => { if (confirm(`Only resubscribe ${email} if they asked to be added back. Continue?`)) start(() => setContactStatus(slug, id, "subscribed")) }}>Resubscribe…</DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm(`Delete ${email} and their history?`)) start(() => deleteContact(slug, id)) }}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
