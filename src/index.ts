import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { webChannel } from "./channels/web.js";
import { BotRegistry } from "./core/bots.js";
import { getProviderConfig, server } from "./core/config.js";
import { ChatEngine } from "./core/engine.js";
import { MemoryStore } from "./core/store.js";
import { TranscriptStore } from "./core/transcripts.js";

try {
  process.loadEnvFile(); // .env, if present
} catch {
  // no .env file: rely on real environment variables
}

const transcripts = new TranscriptStore(server.transcriptsDir);
const engine = new ChatEngine(new BotRegistry(server.botsDir), new MemoryStore(), transcripts);

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));

// Channels: each one translates its platform into engine calls. Add new ones here.
app.route("/", webChannel(engine));
// app.route("/", telegramChannel(engine));   // future
// app.route("/", whatsappChannel(engine));   // future

// widget.js (the <script> embedded in websites) and a demo page.
app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: server.port }, async (info) => {
  console.log(`Chatbot running on http://localhost:${info.port}`);
  console.log(`Bots: ${engine.bots.ids().join(", ")}  |  Demo page: http://localhost:${info.port}/demo.html`);
  if (!getProviderConfig()) console.warn("No AI provider configured - set CHAT_API_KEY in .env (see .env.example).");

  const problem = await transcripts.check();
  if (problem) console.error(`Transcripts folder "${server.transcriptsDir}" is not writable - visitors will not be able to start chats: ${problem}`);
  else console.log(`Transcripts: ${server.transcriptsDir}`);
});
