import type { BotRegistry } from "./bots.js";
import { getProviderConfig, limits } from "./config.js";
import { buildSystemPrompt } from "./prompt.js";
import { streamReply } from "./providers.js";
import { checkLimits } from "./rate-limit.js";
import type { ConversationStore } from "./store.js";
import type { TranscriptStore } from "./transcripts.js";
import { ChatError, type InboundMessage } from "./types.js";

const FALLBACK = "\n\nSorry, something went wrong. Please try again or contact us.";

/**
 * The channel-independent brain: validates, rate-limits, adds history,
 * streams the model's reply and records the exchange. Every channel
 * (website, Telegram, WhatsApp...) calls this and nothing else.
 */
export class ChatEngine {
  constructor(
    readonly bots: BotRegistry,
    private store: ConversationStore,
    readonly transcripts: TranscriptStore,
  ) {}

  /**
   * Throws ChatError for anything that should be rejected before replying
   * (so HTTP channels can still answer with a proper status code); otherwise
   * returns the reply as a stream of text chunks.
   */
  start(msg: InboundMessage, signal: AbortSignal): AsyncGenerator<string> {
    const bot = this.bots.get(msg.botId);
    if (!bot) throw new ChatError("not_found", 404);

    const config = getProviderConfig();
    if (!config) throw new ChatError("unavailable", 503);

    const text = msg.text.trim();
    if (!text || text.length > limits.maxMessageChars) throw new ChatError("invalid_request", 400);

    const limit = checkLimits(bot.id, msg.userKey);
    if (limit === "daily") throw new ChatError("unavailable", 503);
    if (limit === "user") throw new ChatError("rate_limited", 429);

    const key = `${bot.id}:${msg.channel}:${msg.conversationId}`;
    const system = buildSystemPrompt(bot, msg.channel);
    const { store, transcripts } = this;

    return (async function* () {
      // In-memory history is a cache; after expiry or a restart, rebuild it from the transcript.
      const cached = store.get(key);
      const history = cached.length
        ? cached
        : await transcripts.recent(bot.id, msg.channel, msg.conversationId, limits.historyMessages);
      const messages = [...history, { role: "user" as const, content: text }];

      let reply = "";
      try {
        for await (const chunk of streamReply(config, system, messages, signal)) {
          reply += chunk;
          yield chunk;
        }
      } catch (error) {
        if (!signal.aborted) {
          console.error("[chat] failed:", error instanceof Error ? error.message : error);
          yield FALLBACK;
        }
        return; // a failed turn isn't remembered, so history keeps alternating user/assistant
      }
      if (reply.trim()) {
        const exchange = [
          { role: "user" as const, content: text },
          { role: "assistant" as const, content: reply },
        ];
        store.append(key, ...(cached.length ? [] : history), ...exchange);
        await transcripts.append(bot.id, msg.channel, msg.conversationId, ...exchange);
      }
    })();
  }

  /** For channels that can't stream (SMS, WhatsApp...): waits for the full reply. */
  async reply(msg: InboundMessage, signal: AbortSignal): Promise<string> {
    let text = "";
    for await (const chunk of this.start(msg, signal)) text += chunk;
    return text.trim();
  }
}
