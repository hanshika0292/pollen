"use client"

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

export function EngagementChart({ data }: { data: { day: string; opens: number; clicks: number }[] }) {
  if (!data.some((d) => d.opens || d.clicks)) return <p className="py-10 text-center text-sm text-muted-foreground">No opens or clicks yet — send a campaign to see engagement here.</p>
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="opens" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient>
            <linearGradient id="clicks" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.45} /><stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} interval={6} stroke="var(--muted-foreground)" />
          <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" />
          <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
          <Area type="monotone" dataKey="opens" name="Opens" stroke="var(--chart-1)" strokeWidth={2} fill="url(#opens)" />
          <Area type="monotone" dataKey="clicks" name="Clicks" stroke="var(--chart-2)" strokeWidth={2} fill="url(#clicks)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
