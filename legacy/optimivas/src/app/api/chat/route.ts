import { chatLimits, getChatConfig } from "@/lib/chat/config";
import { buildSystemPrompt } from "@/lib/chat/knowledge";
import { streamReply, type ChatMessage } from "@/lib/chat/providers";
import { checkLimits } from "@/lib/chat/rate-limit";

const json = (error: string, status: number) => Response.json({ error }, { status });

function parseMessages(body: unknown): ChatMessage[] | null {
  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const messages: ChatMessage[] = [];
  for (const m of raw.slice(-chatLimits.maxMessages)) {
    const { role, content } = (m ?? {}) as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim();
    if (!text || text.length > chatLimits.maxMessageChars) return null;
    messages.push({ role, content: text });
  }
  // The API needs the conversation to start with, and end on, the visitor's message.
  while (messages.length && messages[0].role !== "user") messages.shift();
  return messages.length && messages.at(-1)!.role === "user" ? messages : null;
}

export async function POST(request: Request) {
  // Only accept requests made from this site's own pages.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return json("forbidden", 403);

  const config = getChatConfig();
  if (!config) return json("unavailable", 503);

  const visitor = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const limit = checkLimits(visitor);
  if (limit !== "ok") return json(limit === "daily" ? "unavailable" : "rate_limited", limit === "daily" ? 503 : 429);

  const body = await request.json().catch(() => null);
  const messages = parseMessages(body);
  if (!messages) return json("invalid_request", 400);

  const system = buildSystemPrompt();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamReply(config, system, messages, request.signal)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        if (!request.signal.aborted) {
          console.error("[chat] failed:", error instanceof Error ? error.message : error);
          controller.enqueue(encoder.encode("\n\nSorry, something went wrong. Please try again or contact us."));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
