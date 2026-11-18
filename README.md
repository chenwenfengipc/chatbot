# Chatbot

A standalone AI chatbot server. The brain (`src/core`) knows nothing about any
particular app; each **channel** is a thin adapter that turns an app's messages
into engine calls. Website widget is channel #1.

```
 Website widget ─┐
 Telegram     ───┤                 ┌─ rate limits
 WhatsApp     ───┼─► channel ─► ChatEngine ─┼─ history (server-side)
 SMS / others ───┘   adapter       │        ├─ bot prompt + knowledge
                                   │        └─ AI provider (Claude / any OpenAI-compatible)
```

## Run it

```bash
npm install
cp .env.example .env     # set CHAT_API_KEY
npm run dev              # http://localhost:8787/demo.html
```

## Run it with Docker

```bash
cp .env.example .env            # set CHAT_API_KEY (and the other settings you need)
docker compose up -d --build    # builds the image and starts it on 127.0.0.1:8787
docker compose logs -f chatbot
```

- `./data/bots` is mounted into the container, so after editing a bot's `bot.json` or knowledge files just run `docker compose restart chatbot` – no rebuild.
- The port is published on `127.0.0.1` only. Expose it publicly through a reverse proxy with HTTPS: `deploy/nginx-chat.conf` is a ready nginx site (then `sudo certbot --nginx -d chat.optimivas.com`). Compose sets `TRUST_PROXY=true` because of that proxy; remove it if you publish the port directly.
- `./data/transcripts` is mounted read-write for saved conversations. The container runs as uid 1000, so create it once on the server: `mkdir -p data/transcripts && sudo chown 1000:1000 data/transcripts`. If it isn't writable, the server logs an error at startup and visitors can't start chats.
- Health check: `GET /health`. After code changes, redeploy with `docker compose up -d --build`. After editing `.env`, run `docker compose up -d` (a plain `restart` keeps the old values).

## Put it on a website

```html
<script src="https://YOUR-CHATBOT-HOST/widget.js" data-bot="demo" async></script>
```

The website's origin must be listed in that bot's `allowedOrigins`.

Visitors first fill in a short form (name and email required; phone and description optional), then chat. Their conversation survives page reloads and navigation within the same browser tab (`sessionStorage`, cleared when the tab closes).

## Transcripts

Every conversation is saved to `data/transcripts/<botId>/<channel>_<conversationId>.jsonl` (change the folder with `TRANSCRIPTS_DIR`): the visitor's details on the first line, then each message with a timestamp. Only completed exchanges are recorded.

```bash
npm run transcripts                        # list conversations, newest first
npm run transcripts -- optimivas/web_57ae  # print one (a unique part of the name is enough)
docker compose exec chatbot node dist/transcripts-cli.js   # same, inside Docker
```

These files contain personal data (name, email, phone, what visitors wrote). Keep the folder private, back it up, decide how long to keep it, and say so in your privacy policy (set `privacyUrl` in `bot.json` so the widget links to it). To erase someone's data, delete their file. The server also uses the transcript to give the AI context again after a restart or after 30 idle minutes.

## Bots and knowledge

One folder per bot in `data/bots/<id>/`:

- `bot.json` – name, greeting, starter questions, contact details, `allowedOrigins`, accent colour, `extraRules`
- `*.md` / `*.txt` – everything the bot is allowed to answer from (prices, features, policies…)

Edit, restart (dev mode restarts automatically). One server can host many bots for many websites.

## Adding a channel (Telegram, WhatsApp, …)

1. Create `src/channels/<name>.ts` exporting a Hono app (see `web.ts`).
2. On each incoming message call `engine.reply({ botId, channel: "telegram", conversationId: chatId, userKey: userId, text }, signal)` and send the returned text back with the platform's API. Use `engine.start()` instead if the platform supports streaming.
3. Mount it in `src/index.ts`.

Setting `channel` to anything other than `"web"` automatically switches the bot to plain-text replies with full URLs. History is kept server-side, so channels only pass the newest message.

## Notes / next steps

- Rate limits and the short-term history cache are in memory (one instance). Transcripts are plain files, so several instances would need a shared database or storage instead.
- Set a spending cap in your AI provider's dashboard as the final abuse backstop.
- `legacy/optimivas/` holds the original Next.js version this was extracted from, for reference.
