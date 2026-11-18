// Settings read from environment variables (see .env.example).

export type ProviderKind = "anthropic" | "openai-compatible";

export interface ProviderConfig {
  provider: ProviderKind;
  model: string;
  apiKey: string;
  /** Only used by openai-compatible providers */
  baseUrl: string;
}

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);

/** Returns null when the AI provider isn't configured, so the engine can answer "unavailable". */
export function getProviderConfig(): ProviderConfig | null {
  const provider = (process.env.CHAT_PROVIDER ?? "anthropic").trim().toLowerCase();

  if (provider === "anthropic") {
    const apiKey = process.env.CHAT_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return { provider, apiKey, model: process.env.CHAT_MODEL || "claude-haiku-5-5", baseUrl: "" };
  }

  if (provider === "openai-compatible") {
    const baseUrl = (process.env.CHAT_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = process.env.CHAT_MODEL;
    const apiKey = process.env.CHAT_API_KEY ?? "";
    // A key is optional only for local models (e.g. Ollama).
    if (!model || (!apiKey && !isLocal(baseUrl))) return null;
    return { provider, apiKey, model, baseUrl };
  }

  return null;
}

export const limits = {
  perUser: Number(process.env.CHAT_RATE_LIMIT) || 15,
  windowMs: 10 * 60 * 1000,
  perDay: Number(process.env.CHAT_DAILY_LIMIT) || 2000,
  /** Messages of history sent to the model with each request. */
  historyMessages: 10,
  maxMessageChars: 1024,
  maxOutputTokens: 1024,
  /** Idle conversations are forgotten after this long. */
  conversationTtlMs: 30 * 60 * 1000,
  maxConversations: 1000,
} as const;

export const server = {
  port: Number(process.env.PORT) || 8787,
  /** Set TRUST_PROXY=true only behind a reverse proxy you control, so X-Forwarded-For can be believed. */
  trustProxy: process.env.TRUST_PROXY === "true",
  botsDir: process.env.BOTS_DIR || "data/bots",
  /** Where conversation transcripts (including visitors' contact details) are written. */
  transcriptsDir: process.env.TRANSCRIPTS_DIR || "data/transcripts",
};
