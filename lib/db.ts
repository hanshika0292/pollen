import "server-only"
import { Pool, type PoolClient, type QueryResultRow } from "pg"

/**
 * Data access with tenant isolation.
 *
 * The app connects as `pollen_app`, a role that cannot bypass row-level
 * security. Tenant data is only reachable inside `withTenant`, which pins the
 * transaction to one workspace via `app.workspace_id`; Postgres policies do
 * the filtering. `withAdmin` is reserved for the platform console.
 */

declare global {
  // eslint-disable-next-line no-var
  var _pollenPool: Pool | undefined
}

function pool(): Pool {
  if (!global._pollenPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error("DATABASE_URL is not set")
    global._pollenPool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 5,
    })
  }
  return global._pollenPool
}

export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>
  one<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | null>
}

function wrap(client: PoolClient): Db {
  // A transaction is one connection; callers may still Promise.all() several
  // reads, so queue them explicitly rather than relying on pg's implicit queue.
  let tail: Promise<unknown> = Promise.resolve()
  const run = <T extends QueryResultRow>(text: string, params?: unknown[]) => {
    const next = tail.then(() => client.query<T>(text, params))
    tail = next.catch(() => {})
    return next
  }
  return {
    async query<T extends QueryResultRow>(text: string, params?: unknown[]) {
      return (await run<T>(text, params)).rows
    },
    async one<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T | null> {
      return (await run<T>(text, params)).rows[0] ?? null
    },
  }
}

async function tx<T>(settings: Record<string, string>, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query("begin")
    for (const [key, value] of Object.entries(settings)) {
      // is_local = true: the setting dies with the transaction, so a pooled
      // connection can never leak one tenant's context into the next request.
      await client.query("select set_config($1, $2, true)", [key, value])
    }
    const result = await fn(wrap(client))
    await client.query("commit")
    return result
  } catch (err) {
    await client.query("rollback").catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Platform-level tables only (users, workspaces, memberships, audit_log). */
export function withGlobal<T>(fn: (db: Db) => Promise<T>) {
  return tx({}, fn)
}

/** Everything a tenant owns. RLS restricts every query to `workspaceId`. */
export function withTenant<T>(workspaceId: string, fn: (db: Db) => Promise<T>) {
  if (!workspaceId) throw new Error("withTenant requires a workspace id")
  return tx({ "app.workspace_id": workspaceId }, fn)
}

/** Cross-tenant reads/writes for the platform admin console. */
export function withAdmin<T>(fn: (db: Db) => Promise<T>) {
  return tx({ "app.platform_admin": "on" }, fn)
}

export async function audit(
  db: Db,
  entry: { workspaceId?: string | null; actorUserId?: string | null; action: string; target?: string; meta?: object },
) {
  await db.query(
    `insert into audit_log (workspace_id, actor_user_id, action, target, meta) values ($1, $2, $3, $4, $5)`,
    [entry.workspaceId ?? null, entry.actorUserId ?? null, entry.action, entry.target ?? null, entry.meta ?? {}],
  )
}
