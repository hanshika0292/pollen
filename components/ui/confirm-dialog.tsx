"use client"

import { useEffect, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface ConfirmDialogProps {
  open:        boolean
  onConfirm:   () => void
  onCancel:    () => void
  title:       string
  description: string
  confirmLabel?: string
  /** "destructive" renders the confirm button in red */
  variant?:    "destructive" | "default"
  /** If set, user must type this exact string to enable the confirm button (double confirmation) */
  requireText?: string
}

export function ConfirmDialog({
  open, onConfirm, onCancel,
  title, description,
  confirmLabel = "Confirm",
  variant = "default",
  requireText,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("")

  useEffect(() => { if (!open) setTyped("") }, [open])

  // Compare both sides trimmed + case-insensitive — names can carry trailing
  // whitespace (e.g. legacy CRM imports) which would otherwise make confirm
  // impossible without the user noticing the invisible char.
  const matches = !requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase()

  return (
    <AlertDialog open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {requireText && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-require-text" className="text-xs text-muted-foreground">
              Type <span className="font-mono font-semibold text-foreground">{requireText}</span> to confirm
            </Label>
            <Input
              id="confirm-require-text"
              autoComplete="off"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireText}
              className="h-8 text-sm"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={!matches}
            className={cn(
              variant === "destructive" && buttonVariants({ variant: "destructive" }),
              !matches && "opacity-50 cursor-not-allowed",
            )}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
