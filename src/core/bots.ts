import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Bot } from "./types.js";

type BotFile = Partial<Omit<Bot, "id" | "knowledge">> & { name: string; allowedOrigins: string[] };

/**
 * Each folder in data/bots/ is one bot:
 *   bot.json      identity + settings (see Bot in types.ts)
 *   *.md / *.txt  knowledge the bot answers from (read in filename order)
 */
export class BotRegistry {
  private bots = new Map<string, Bot>();

  constructor(dir: string) {
    if (!existsSync(dir)) throw new Error(`Bots folder not found: ${dir}`);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const bot = loadBot(join(dir, entry.name), entry.name);
      this.bots.set(bot.id, bot);
    }
    if (!this.bots.size) throw new Error(`No bots found in ${dir}`);
  }

  get(id: string): Bot | undefined {
    return this.bots.get(id);
  }

  ids(): string[] {
    return [...this.bots.keys()];
  }
}

function loadBot(dir: string, id: string): Bot {
  const file = join(dir, "bot.json");
  if (!existsSync(file)) throw new Error(`Missing ${file}`);
  const raw = JSON.parse(readFileSync(file, "utf8")) as BotFile;
  if (!raw.name || !Array.isArray(raw.allowedOrigins)) {
    throw new Error(`${file} needs at least "name" and "allowedOrigins"`);
  }

  const knowledge = readdirSync(dir)
    .filter((f) => /\.(md|txt)$/i.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8").trim())
    .join("\n\n");

  return {
    id,
    name: raw.name,
    description: raw.description ?? "",
    siteUrl: (raw.siteUrl ?? "").replace(/\/+$/, ""),
    contactUrl: raw.contactUrl ?? "/contact",
    contactEmail: raw.contactEmail ?? "",
    greeting: raw.greeting ?? `Hi! I'm the ${raw.name} assistant. How can I help?`,
    starters: raw.starters ?? [],
    allowedOrigins: raw.allowedOrigins.map((o) => o.replace(/\/+$/, "")),
    accentColor: raw.accentColor ?? "#2563eb",
    privacyUrl: raw.privacyUrl ?? "",
    extraRules: raw.extraRules ?? [],
    knowledge,
  };
}
