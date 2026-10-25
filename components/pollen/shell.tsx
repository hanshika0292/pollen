"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import {
  LayoutDashboard, Mail, Users, ListChecks, Filter, Palette, Settings, Building2, LogOut, ScrollText, Menu, X, MessageCircle,
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { PollenLogo } from "./logo"

const ICONS = { LayoutDashboard, Mail, Users, ListChecks, Filter, Palette, Settings, Building2, ScrollText, MessageCircle }
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; exact?: boolean }

export function Shell({
  nav, title, subtitle, user, banner, children,
}: {
  nav: NavItem[]
  title: string
  subtitle?: string
  user: { name: string; email: string }
  banner?: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const sidebar = (
    <div className="flex h-full flex-col gap-6 bg-sidebar p-4 text-sidebar-foreground">
      <div className="flex items-center justify-between px-2 pt-1">
        <PollenLogo light />
        <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
      </div>
      <div className="rounded-lg bg-sidebar-accent/60 px-3 py-2.5">
        <p className="truncate text-sm font-semibold">{title}</p>
        {subtitle && <p className="truncate text-xs text-sidebar-foreground/60">{subtitle}</p>}
      </div>
      <nav className="flex flex-1 flex-col gap-0.5">
        {nav.map((item) => {
          const Icon = ICONS[item.icon]
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/")
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="flex items-center gap-3 border-t border-sidebar-border px-2 pt-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
          {user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-sidebar-foreground/60">{user.email}</p>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/login" })} className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Sign out" title="Sign out">
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        <div className="flex items-center gap-3 border-b bg-card px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
          <PollenLogo />
        </div>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  )
}
