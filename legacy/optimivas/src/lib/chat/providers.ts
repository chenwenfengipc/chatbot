import Anthropic from "@anthropic-ai/sdk";
import { chatLimits, type ChatConfig } from "./config";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Streams the assistant's reply as text chunks, whichever provider is configured. */
export function streamReply(
  config: ChatConfig,
  system: string,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  return config.provider === "anthropic"
    ? streamAnthropic(config, system, messages, signal)
    : streamOpenAICompatible(config, system, messages, signal);
}

async function* streamAnthropic(config: ChatConfig, system: string, messages: ChatMessage[], signal: AbortSignal) {
  const client = new Anthropic({ apiKey: config.apiKey });
  const stream = client.messages.stream(
    {
      model: config.model,
      max_tokens: chatLimits.maxOutputTokens,
      // Short replies, low latency. The site knowledge is identical on every
      // request, so it is marked cacheable.
      output_config: { effort: "low" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
    },
    { signal },
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
  }

  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    yield "\n\nSorry, I can't help with that. Please contact us and a person will follow up.";
  }
}

/** Chat Completions API shape, spoken by OpenAI, Google Gemini, Groq, OpenRouter, Together, Ollama and many others. */
async function* streamOpenAICompatible(config: ChatConfig, system: string, messages: ChatMessage[], signal: AbortSignal) {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      max_tokens: chatLimits.maxOutputTokens,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });

  if (!res.ok || !res.body) {
    // Log the provider's reason server-side only; the visitor gets a generic message.
    console.error(`[chat] provider error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    throw new Error("provider_error");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      try {
        const text = JSON.parse(data).choices?.[0]?.delta?.content;
        if (typeof text === "string" && text) yield text;
      } catch {
        // ignore keep-alive / non-JSON lines
      }
    }
  }
}
