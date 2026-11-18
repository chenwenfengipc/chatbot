# Chatbot backup (extracted from optimivas)

Files copied from the website project so the chatbot can become a standalone app:

- `src/app/api/chat/route.ts`   server route (validation, origin check, rate limit, streaming)
- `src/lib/chat/config.ts`      provider settings from env vars (see .env.example)
- `src/lib/chat/providers.ts`   Claude (@anthropic-ai/sdk) + OpenAI-compatible streaming
- `src/lib/chat/knowledge.ts`   builds the system prompt from the website's data files
                                (imports @/content, @/lib/pricing, @/site.config - replace with your own knowledge source)
- `src/lib/chat/rate-limit.ts`  in-memory limits
- `src/components/chat-widget.tsx` floating chat window (uses @/site.config for name/email)
- `.env.example`                provider settings

Needs: `npm install @anthropic-ai/sdk`. Next.js route handler + React client component.
Lesson learned: React effects must not return a value implicitly (use block bodies).
