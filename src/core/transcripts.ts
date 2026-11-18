import { existsSync } from "node:fs";
import { access, appendFile, constants, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChatMessage, Contact } from "./types.js";

/**
 * Permanent record of every conversation, one JSON-lines file each:
 *   <dir>/<botId>/<channel>_<conversationId>.jsonl
 *   {"type":"contact","ts":...,"name":...,"email":...}      (website visitors only; first line)
 *   {"type":"message","ts":...,"role":"user","text":...}
 * Unlike ConversationStore (a short-lived cache), this is what you review later,
 * and what the engine rebuilds the model's context from after a restart.
 * Files hold personal data, so they are created readable by the server user only.
 */
export class TranscriptStore {
  constructor(private dir: string) {}

  private file(botId: string, channel: string, id: string): string {
    const safe = (s: string) => s.replace(/[^\w-]/g, "_").slice(0, 80);
    return join(this.dir, safe(botId), `${safe(channel)}_${safe(id)}.jsonl`);
  }

  /** Is there a transcript for this conversation (i.e. has the visitor registered)? */
  has(botId: string, channel: string, id: string): boolean {
    return existsSync(this.file(botId, channel, id));
  }

  /** Creates the transcript with the visitor's details. Throws if it can't be written. */
  async start(botId: string, channel: string, id: string, contact: Contact): Promise<void> {
    await this.write(this.file(botId, channel, id), [{ type: "contact", ts: new Date().toISOString(), ...contact }]);
  }

  /** Never throws: a disk problem must not break the visitor's chat. */
  async append(botId: string, channel: string, id: string, ...messages: ChatMessage[]): Promise<void> {
    const ts = new Date().toISOString();
    try {
      await this.write(
        this.file(botId, channel, id),
        messages.map((m) => ({ type: "message", ts, role: m.role, text: m.content })),
      );
    } catch (error) {
      console.error("[transcript] write failed:", error instanceof Error ? error.message : error);
    }
  }

  /** The last `count` messages, to give the model context when its in-memory history is gone. */
  async recent(botId: string, channel: string, id: string, count: number): Promise<ChatMessage[]> {
    try {
      const lines = (await readFile(this.file(botId, channel, id), "utf8")).split("\n");
      const messages: ChatMessage[] = [];
      for (const line of lines) {
        if (!line) continue;
        const entry = JSON.parse(line) as { type?: string; role?: "user" | "assistant"; text?: string };
        if (entry.type === "message" && entry.role && typeof entry.text === "string") {
          messages.push({ role: entry.role, content: entry.text });
        }
      }
      const last = messages.slice(-count);
      while (last.length && last[0]!.role !== "user") last.shift(); // API needs to start with the visitor
      return last;
    } catch {
      return [];
    }
  }

  /** Startup check: returns a problem description, or null when the folder is writable. */
  async check(): Promise<string | null> {
    try {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await access(this.dir, constants.W_OK);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private async write(file: string, entries: object[]): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await appendFile(file, entries.map((e) => JSON.stringify(e) + "\n").join(""), { mode: 0o600 });
  }
}
