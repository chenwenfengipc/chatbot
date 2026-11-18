export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** What a website visitor tells us before chatting. */
export interface Contact {
  name: string;
  email: string;
  phone: string;
  description: string;
  /** The website the widget was embedded on. */
  origin: string;
}

/** One chatbot, with its own identity, knowledge and allowed websites. Loaded from data/bots/<id>/. */
export interface Bot {
  id: string;
  name: string;
  description: string;
  /** Public website URL, used to build full links for channels that can't use site paths. */
  siteUrl: string;
  contactUrl: string;
  contactEmail: string;
  greeting: string;
  starters: string[];
  /** Websites allowed to embed the widget (exact origins, or "*" for any - development only). */
  allowedOrigins: string[];
  accentColor: string;
  privacyUrl: string;
  extraRules: string[];
  /** All knowledge files concatenated; what the bot is allowed to answer from. */
  knowledge: string;
}

/**
 * What every channel adapter hands to the engine, whatever app it came from.
 * A channel's only jobs: translate its platform's webhook/request into this,
 * and deliver the reply text back.
 */
export interface InboundMessage {
  botId: string;
  /** "web", "telegram", "whatsapp", ... - also picks the reply formatting. */
  channel: string;
  /** Stable id of the conversation on that channel (chat id, phone number, widget session...). */
  conversationId: string;
  /** Who to rate-limit: IP for web, user/phone id for messaging apps. */
  userKey: string;
  text: string;
}

export type ChatErrorCode = "not_found" | "unavailable" | "rate_limited" | "invalid_request";

export class ChatError extends Error {
  constructor(
    public code: ChatErrorCode,
    public status: number,
  ) {
    super(code);
  }
}
