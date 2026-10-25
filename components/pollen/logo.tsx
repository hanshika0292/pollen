import { cn } from "@/lib/utils"

export function PollenMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" fill="#2f5d45" />
      <g fill="#f0c04a">
        <circle cx="16" cy="9.5" r="4" />
        <circle cx="22.2" cy="14" r="4" />
        <circle cx="19.8" cy="21.3" r="4" />
        <circle cx="12.2" cy="21.3" r="4" />
        <circle cx="9.8" cy="14" r="4" />
      </g>
      <circle cx="16" cy="16" r="3.4" fill="#2f5d45" />
    </svg>
  )
}

export function PollenLogo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <PollenMark />
      <span className={cn("text-lg font-bold tracking-tight", light ? "text-sidebar-foreground" : "text-foreground")}>Pollen</span>
    </span>
  )
}
