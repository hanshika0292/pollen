import "server-only"
import { generateText, Output, type LanguageModel } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogle } from "@ai-sdk/google"
import type { z } from "zod"
import { withTenant } from "@/lib/db"
import { unseal } from "@/lib/crypto"
import { PROVIDERS, type Provider } from "./providers"

export { PROVIDERS, type Provider }

/**
 * One entry point for every AI call in Pollen.
 *
 * - BYOK: models are built from the tenant's own (encrypted) provider keys.
 * - Reliable: output is schema-validated, transient errors are retried by the
 *   SDK, calls time out, and if the tenant has a second provider configured we
 *   fail over to it instead of failing the user.
 * - Observable: every attempt is written to ai_runs (tokens, latency, errors)
 *   for per-tenant usage metering and quality tracking.
 */

export type Tier = "quality" | "fast"


export class AiNotConfiguredError extends Error {
  constructor() {
    super("No AI provider is connected for this workspace. Add your API key in Settings → AI.")
  }
}

type Credential = { provider: Provider; key_encrypted: string; quality_model: string; fast_model: string }

export function buildModel(provider: Provider, apiKey: string, modelId: string): LanguageModel {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(modelId)
    case "openai":
      return createOpenAI({ apiKey })(modelId)
    case "google":
      return createGoogle({ apiKey })(modelId)
  }
}

async function credentials(workspaceId: string): Promise<Credential[]> {
  return withTenant(workspaceId, (db) =>
    db.query<Credential>(
      `select provider, key_encrypted, quality_model, fast_model
         from ai_credentials order by is_default desc, created_at asc`,
    ),
  )
}

export async function hasAi(workspaceId: string) {
  return (await credentials(workspaceId)).length > 0
}

function statusOf(err: unknown): number | undefined {
  const e = err as { statusCode?: number; lastError?: { statusCode?: number } }
  return e?.statusCode ?? e?.lastError?.statusCode
}

/** Errors that another provider can't fix are surfaced immediately. */
function isFatal(err: unknown) {
  const status = statusOf(err)
  return status === 400 && !/overloaded|rate/i.test(String((err as Error)?.message))
}

export function friendlyAiError(err: unknown): string {
  if (err instanceof AiNotConfiguredError) return err.message
  const status = statusOf(err)
  if (status === 401 || status === 403) return "The AI provider rejected the API key. Check it in Settings → AI."
  if (status === 404) return "The configured model wasn't found. Check the model name in Settings → AI."
  if (status === 429) return "The AI provider is rate-limiting this key. Try again in a minute."
  return "The AI request failed. Please try again."
}

export type RunContext = { workspaceId: string; userId: string | null }

export type RunResult<T> = { output: T; provider: Provider; model: string; latencyMs: number }

export async function runObject<S extends z.ZodTypeAny>(
  ctx: RunContext,
  opts: {
    feature: string
    tier: Tier
    schema: S
    system: string
    prompt: string
    temperature?: number
    qualityScore?: (output: z.infer<S>) => number | undefined
  },
): Promise<RunResult<z.infer<S>>> {
  const creds = await credentials(ctx.workspaceId)
  if (creds.length === 0) throw new AiNotConfiguredError()

  let lastError: unknown
  for (const cred of creds) {
    const modelId = opts.tier === "quality" ? cred.quality_model : cred.fast_model
    const started = Date.now()
    try {
      const result = await generateText({
        model: buildModel(cred.provider, unseal(cred.key_encrypted), modelId),
        output: Output.object({ schema: opts.schema }),
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature,
        maxRetries: 2,
        timeout: 90_000,
      })
      const latencyMs = Date.now() - started
      const output = result.output as z.infer<S>
      await log(ctx, {
        feature: opts.feature, provider: cred.provider, model: modelId, status: "ok", latencyMs,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
        qualityScore: opts.qualityScore?.(output),
      })
      return { output, provider: cred.provider, model: modelId, latencyMs }
    } catch (err) {
      lastError = err
      await log(ctx, {
        feature: opts.feature, provider: cred.provider, model: modelId, status: "error",
        latencyMs: Date.now() - started, error: String((err as Error)?.message ?? err).slice(0, 500),
      })
      if (isFatal(err)) break
    }
  }
  throw lastError
}

async function log(
  ctx: RunContext,
  run: {
    feature: string; provider: Provider; model: string; status: "ok" | "error"; latencyMs: number
    inputTokens?: number; outputTokens?: number; qualityScore?: number; error?: string
  },
) {
  // Logging must never break the user's request.
  await withTenant(ctx.workspaceId, (db) =>
    db.query(
      `insert into ai_runs (user_id, feature, provider, model, status, input_tokens, output_tokens, latency_ms, quality_score, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [ctx.userId, run.feature, run.provider, run.model, run.status, run.inputTokens ?? null,
       run.outputTokens ?? null, run.latencyMs, run.qualityScore ?? null, run.error ?? null],
    ),
  ).catch((e) => console.error("[ai_runs] log failed", e))
}

/** Cheap round-trip used by the "Test key" button in settings. */
export async function testKey(provider: Provider, apiKey: string, model: string) {
  const { text } = await generateText({
    model: buildModel(provider, apiKey, model),
    prompt: "Reply with the single word: ok",
    maxRetries: 0,
    timeout: 30_000,
  })
  return text.trim().length > 0
}
