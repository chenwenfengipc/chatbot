// Chatbot provider settings, read from environment variables (see .env.example).

export type ProviderKind = "anthropic" | "openai-compatible";

export interface ChatConfig {
  provider: ProviderKind;
  model: string;
  apiKey: string;
  /** Only used by openai-compatible providers */
  baseUrl: string;
}

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);

/** Returns null when the chatbot isn't configured, so the route can answer "unavailable". */
export function getChatConfig(): ChatConfig | null {
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

export const chatLimits = {
  perVisitor: Number(process.env.CHAT_RATE_LIMIT) || 15,
  windowMs: 10 * 60 * 1000,
  perDay: Number(process.env.CHAT_DAILY_LIMIT) || 2000,
  maxMessages: 10,
  maxMessageChars: 1000,
  maxOutputTokens: 1024,
} as const;
