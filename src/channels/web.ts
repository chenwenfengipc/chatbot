import { randomUUID } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { server } from "../core/config.js";
import type { ChatEngine } from "../core/engine.js";
import { checkLimits } from "../core/rate-limit.js";
import { ChatError, type Bot, type Contact } from "../core/types.js";

/**
 * Website channel. Serves the embeddable widget's endpoints:
 *   GET  /v1/web/:botId/config   what the widget needs to draw itself
 *   POST /v1/web/:botId/start    { name, email, phone?, description? } -> { conversationId }
 *   POST /v1/web/:botId/chat     { message, conversationId } -> streamed text reply
 * Visitors must register (start) before they can chat; their details are the
 * first line of the conversation's transcript. Only websites listed in the
 * bot's allowedOrigins may call these from a browser.
 */
export function webChannel(engine: ChatEngine): Hono {
  const app = new Hono();

  const isAllowed = (bot: Bot, origin: string) => bot.allowedOrigins.includes("*") || bot.allowedOrigins.includes(origin);
  const fail = (c: Context, e: ChatError) => c.json({ error: e.code }, e.status as 400);
  const clientIp = (c: Context) =>
    (server.trustProxy ? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() : undefined) ||
    getConnInfo(c).remote.address ||
    "unknown";

  app.use("/v1/web/:botId/*", async (c, next) => {
    const bot = engine.bots.get(c.req.param("botId"));
    if (!bot) return c.json({ error: "not_found" }, 404);

    const origin = c.req.header("origin");
    // No Origin header = not a browser page (curl, server-to-server): allowed, and still rate-limited.
    if (origin && !isAllowed(bot, origin)) return c.json({ error: "forbidden" }, 403);
    if (origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type");
      c.header("Access-Control-Max-Age", "86400");
      return c.body(null, 204);
    }
    await next();
  });

  app.get("/v1/web/:botId/config", (c) => {
    const bot = engine.bots.get(c.req.param("botId"))!;
    return c.json({
      name: bot.name,
      greeting: bot.greeting,
      starters: bot.starters,
      accentColor: bot.accentColor,
      privacyUrl: bot.privacyUrl,
      // https links to these sites may be rendered clickable by the widget
      linkHosts: bot.allowedOrigins.filter((o) => o !== "*").map((o) => new URL(o).host),
    });
  });

  app.post("/v1/web/:botId/start", async (c) => {
    const bot = engine.bots.get(c.req.param("botId"))!;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;

    const contact = validateContact(body, c.req.header("origin") ?? "");
    if ("invalid" in contact) return c.json({ error: "invalid_contact", field: contact.invalid }, 400);

    // Each registration creates a file, so it is rate-limited like messages are.
    const limit = checkLimits(bot.id, `start:${clientIp(c)}`);
    if (limit === "daily") return fail(c, new ChatError("unavailable", 503));
    if (limit === "user") return fail(c, new ChatError("rate_limited", 429));

    const conversationId = randomUUID();
    try {
      await engine.transcripts.start(bot.id, "web", conversationId, contact);
    } catch (error) {
      console.error("[transcript] cannot start conversation:", error instanceof Error ? error.message : error);
      return fail(c, new ChatError("unavailable", 503));
    }
    return c.json({ conversationId });
  });

  app.post("/v1/web/:botId/chat", async (c) => {
    const bot = engine.bots.get(c.req.param("botId"))!;
    const body = (await c.req.json().catch(() => null)) as { message?: unknown; conversationId?: unknown } | null;
    if (typeof body?.message !== "string") return fail(c, new ChatError("invalid_request", 400));

    const id = body.conversationId;
    if (typeof id !== "string" || !/^[\w-]{8,64}$/.test(id) || !engine.transcripts.has(bot.id, "web", id)) {
      return c.json({ error: "registration_required" }, 400);
    }

    // Stop the model call if the visitor closes the page mid-reply.
    const abort = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => abort.abort());

    let reply: AsyncGenerator<string>;
    try {
      reply = engine.start(
        { botId: bot.id, channel: "web", conversationId: id, userKey: clientIp(c), text: body.message },
        abort.signal,
      );
    } catch (e) {
      if (e instanceof ChatError) return fail(c, e);
      throw e;
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of reply) controller.enqueue(encoder.encode(chunk));
        } finally {
          controller.close();
        }
      },
      cancel() {
        abort.abort();
      },
    });

    return c.body(stream, 200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
  });

  return app;
}

// Strips control characters (keeping line breaks), trims, and caps the length.
const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

/** name and email are required; phone and description are optional but must look right if given. */
function validateContact(body: Record<string, unknown> | null, origin: string): Contact | { invalid: string } {
  const name = clean(body?.name, 100);
  const email = clean(body?.email, 254);
  const phone = clean(body?.phone, 30);
  const description = clean(body?.description, 500);

  if (!name) return { invalid: "name" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { invalid: "email" };
  if (phone && !/^[\d\s+().-]{5,30}$/.test(phone)) return { invalid: "phone" };
  return { name, email, phone, description, origin };
}
