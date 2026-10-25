import { z } from "zod"

/**
 * Segment rules: a small, closed vocabulary that compiles to parameterised
 * SQL. The AI segment builder produces this structure (never SQL), and it is
 * validated before it's saved or run — so a model can't widen access or
 * produce a query that doesn't mean what the preview shows.
 */

export const FIELDS = {
  status: { label: "Status", ops: ["is", "is_not"], value: "enum:subscribed,unsubscribed,bounced,complained" },
  tag: { label: "Tag", ops: ["has", "not_has"], value: "text" },
  source: { label: "Source", ops: ["is", "is_not"], value: "text" },
  email_domain: { label: "Email domain", ops: ["is", "is_not"], value: "text" },
  attribute: { label: "Custom field", ops: ["is", "is_not", "contains", "exists"], value: "key=value" },
  list: { label: "List", ops: ["in", "not_in"], value: "list_id" },
  joined_days: { label: "Joined (days ago)", ops: ["within", "older_than"], value: "number" },
  engaged_days: { label: "Last engaged (days ago)", ops: ["within", "older_than", "never"], value: "number" },
  opened_days: { label: "Opened an email in the last N days", ops: ["yes", "no"], value: "number" },
  clicked_days: { label: "Clicked an email in the last N days", ops: ["yes", "no"], value: "number" },
} as const

export type Field = keyof typeof FIELDS

export const conditionSchema = z.object({
  field: z.enum(Object.keys(FIELDS) as [Field, ...Field[]]),
  op: z.string(),
  value: z.string().describe("Always a string. Numbers as digits; for attribute use key=value (or just key for exists); for list use the list id."),
})
export const rulesSchema = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).max(12),
})
export type Rules = z.infer<typeof rulesSchema>
export type Condition = z.infer<typeof conditionSchema>

export function validateRules(rules: Rules, listIds: string[]): string[] {
  const errors: string[] = []
  for (const c of rules.conditions) {
    const spec = FIELDS[c.field]
    if (!(spec.ops as readonly string[]).includes(c.op)) errors.push(`"${c.op}" isn't valid for ${spec.label}.`)
    if (spec.value === "number" && c.op !== "never" && !/^\d{1,4}$/.test(c.value)) errors.push(`${spec.label} needs a whole number of days.`)
    if (spec.value.startsWith("enum:") && !spec.value.slice(5).split(",").includes(c.value)) errors.push(`Unknown ${spec.label.toLowerCase()} "${c.value}".`)
    if (spec.value === "list_id" && !listIds.includes(c.value)) errors.push("That list doesn't exist in this workspace.")
    if ((spec.value === "text" || spec.value === "key=value") && !c.value.trim()) errors.push(`${spec.label} needs a value.`)
  }
  return errors
}

/** Returns a SQL boolean expression over alias `c` (contacts), plus params. */
export function compileRules(rules: Rules, startIndex = 1): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const p = (v: unknown) => {
    params.push(v)
    return `$${startIndex + params.length - 1}`
  }
  const parts = rules.conditions.map((c): string => {
    const neg = ["is_not", "not_has", "not_in", "no"].includes(c.op)
    switch (c.field) {
      case "status":
        return `c.status ${neg ? "<>" : "="} ${p(c.value)}`
      case "tag":
        return `${neg ? "not " : ""}(${p(c.value.trim().toLowerCase())} = any(c.tags))`
      case "source":
        return `c.source ${neg ? "<>" : "="} ${p(c.value.trim())}`
      case "email_domain":
        return `split_part(c.email::text, '@', 2) ${neg ? "<>" : "="} ${p(c.value.trim().toLowerCase().replace(/^@/, ""))}`
      case "attribute": {
        const [k, ...rest] = c.value.split("=")
        const v = rest.join("=").trim()
        if (c.op === "exists") return `(c.attributes ? ${p(k.trim())})`
        if (c.op === "contains") return `(c.attributes->>${p(k.trim())}) ilike ${p(`%${v}%`)}`
        return `coalesce(c.attributes->>${p(k.trim())}, '') ${neg ? "<>" : "="} ${p(v)}`
      }
      case "list":
        return `${neg ? "not " : ""}exists (select 1 from list_members lm where lm.contact_id = c.id and lm.list_id = ${p(c.value)}::uuid)`
      case "joined_days":
        return `c.created_at ${c.op === "within" ? ">=" : "<"} now() - make_interval(days => ${p(Number(c.value))}::int)`
      case "engaged_days":
        if (c.op === "never") return `c.last_engaged_at is null`
        return c.op === "within"
          ? `c.last_engaged_at >= now() - make_interval(days => ${p(Number(c.value))}::int)`
          : `(c.last_engaged_at is null or c.last_engaged_at < now() - make_interval(days => ${p(Number(c.value))}::int))`
      case "opened_days":
      case "clicked_days": {
        const type = c.field === "opened_days" ? "open" : "click"
        return `${neg ? "not " : ""}exists (select 1 from email_events e where e.contact_id = c.id and e.type = '${type}'
                 and e.occurred_at >= now() - make_interval(days => ${p(Number(c.value))}::int))`
      }
    }
  })
  if (parts.length === 0) return { sql: "true", params }
  return { sql: `(${parts.join(rules.match === "all" ? " and " : " or ")})`, params }
}

export function describeCondition(c: Condition, listNames: Record<string, string> = {}): string {
  const spec = FIELDS[c.field]
  const v = c.field === "list" ? `"${listNames[c.value] ?? "unknown list"}"` : `"${c.value}"`
  const op: Record<string, string> = {
    is: "is", is_not: "is not", has: "includes", not_has: "doesn't include", contains: "contains", exists: "is set",
    in: "is in", not_in: "is not in", within: "within the last", older_than: "more than", never: "never",
  }
  if (c.field === "opened_days" || c.field === "clicked_days") {
    const verb = c.field === "opened_days" ? "opened" : "clicked"
    return `${c.op === "no" ? `Hasn't ${verb}` : `${verb[0].toUpperCase()}${verb.slice(1)}`} an email in the last ${c.value} days`
  }
  if (c.field.endsWith("_days")) {
    if (c.op === "never") return `${spec.label}: never`
    return `${spec.label.replace(" (days ago)", "").replace(" in the last N days", "")} ${op[c.op] ?? c.op} ${c.value} days${c.op === "older_than" ? " ago" : ""}`
  }
  return `${spec.label} ${op[c.op] ?? c.op} ${c.op === "exists" ? `"${c.value}"` : v}`
}
