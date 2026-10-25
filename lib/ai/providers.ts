// Provider catalogue shared by server (lib/ai/core) and settings UI.
// Defaults are editable per workspace; these are just sensible starting points.
export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", quality: "claude-sonnet-5", fast: "claude-haiku-4-5", keyHint: "sk-ant-…", keysUrl: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI", quality: "gpt-5.5", fast: "gpt-5.4-mini", keyHint: "sk-…", keysUrl: "https://platform.openai.com/api-keys" },
  google: { label: "Google (Gemini)", quality: "gemini-3.1-pro-preview", fast: "gemini-3.5-flash", keyHint: "AIza…", keysUrl: "https://aistudio.google.com/apikey" },
} as const

export type Provider = keyof typeof PROVIDERS
