"use client"

import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react"
import type { Check } from "@/lib/ai/checks"
import type { Scorecard as Data } from "@/lib/ai/features"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/pollen/ui"
import { cn } from "@/lib/utils"

const DIMENSIONS: [keyof Data["scores"], string][] = [
  ["clarity", "Clarity"], ["voice_match", "Brand voice"], ["relevance", "Relevance"], ["cta_strength", "Call to action"], ["skimmability", "Easy to skim"],
]

function tone(n: number) {
  return n >= 8 ? "text-success" : n >= 6.5 ? "text-warning" : "text-destructive"
}

export function Scorecard({ score, checks, stale, onRescore, pending }: { score: Data | null; checks: Check[]; stale: boolean; onRescore?: () => void; pending: boolean }) {
  const problems = checks.filter((c) => c.level !== "ok")
  return (
    <Panel
      title="Quality check"
      description={score ? `AI editor · ${score.critic_model}${score.passes > 1 ? " · revised once" : ""}` : "Rules run live; the AI editor scores on demand."}
      actions={onRescore && <Button size="sm" variant="outline" onClick={onRescore} disabled={pending}><RefreshCw className={cn(pending && "animate-spin")} /> {score ? "Re-score" : "Score"}</Button>}
    >
      <div className="space-y-5">
        {score && (
          <div className={cn("space-y-3 transition-opacity", stale && "opacity-60")}>
            <div className="flex items-end gap-3">
              <p className={cn("text-4xl font-semibold tabular-nums", tone(score.overall))}>{score.overall}</p>
              <p className="pb-1 text-sm text-muted-foreground">/ 10 {score.overall >= 8 ? "· ready to send" : "· worth another pass"}</p>
            </div>
            {stale && <p className="text-xs text-muted-foreground">Edited since the last score.</p>}
            <div className="space-y-1.5">
              {DIMENSIONS.map(([k, label]) => {
                const v = Math.max(0, Math.min(10, score.scores[k]))
                return (
                  <div key={k} className="grid grid-cols-[110px_1fr_28px] items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", v >= 8 ? "bg-success" : v >= 6.5 ? "bg-warning" : "bg-destructive")} style={{ width: `${v * 10}%` }} /></div>
                    <span className="text-right tabular-nums">{v}</span>
                  </div>
                )
              })}
            </div>
            {score.issues.length > 0 && (
              <ul className="space-y-2 border-t pt-3">
                {score.issues.map((i, n) => (
                  <li key={n} className="text-sm">
                    <span className={cn("mr-1.5 text-xs font-semibold uppercase", i.severity === "high" ? "text-destructive" : i.severity === "medium" ? "text-warning" : "text-muted-foreground")}>{i.severity}</span>
                    {i.issue} <span className="text-muted-foreground">→ {i.fix}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ul className="space-y-1.5 border-t pt-3 text-sm first:border-t-0 first:pt-0">
          {problems.length === 0 && <li className="flex gap-2 text-success"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /> All deliverability and compliance checks pass.</li>}
          {problems.map((c) => (
            <li key={c.id + c.message} className="flex gap-2">
              {c.level === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />}
              <span>{c.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}
