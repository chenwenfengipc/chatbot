import { limits } from "./config.js";
import type { ChatMessage } from "./types.js";

/**
 * Conversation history lives on the server, because messaging apps (WhatsApp,
 * Telegram...) only send the newest message. Swap this for Redis/a database
 * by implementing the same interface.
 */
export interface ConversationStore {
  get(key: string): ChatMessage[];
  append(key: string, ...messages: ChatMessage[]): void;
}

export class MemoryStore implements ConversationStore {
  private chats = new Map<string, { messages: ChatMessage[]; touched: number }>();

  get(key: string): ChatMessage[] {
    const chat = this.chats.get(key);
    if (!chat || Date.now() - chat.touched > limits.conversationTtlMs) return [];
    return chat.messages;
  }

  append(key: string, ...messages: ChatMessage[]): void {
    const now = Date.now();
    const history = [...this.get(key), ...messages].slice(-limits.historyMessages);
    // The model API needs the conversation to start with a user message.
    while (history.length && history[0]!.role !== "user") history.shift();
    this.chats.delete(key); // re-insert so Map order stays oldest-first
    this.chats.set(key, { messages: history, touched: now });

    if (this.chats.size > limits.maxConversations) {
      for (const [k, chat] of this.chats) {
        if (now - chat.touched > limits.conversationTtlMs) this.chats.delete(k);
      }
      // Still too many: drop the least recently used.
      while (this.chats.size > limits.maxConversations) this.chats.delete(this.chats.keys().next().value!);
    }
  }
}
