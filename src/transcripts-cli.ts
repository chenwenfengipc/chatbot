// Review recorded conversations.
//   npm run transcripts                      list all conversations, newest first
//   npm run transcripts -- <botId/file-id>   print one (a unique part of the name is enough)
// In Docker:  docker compose exec chatbot node dist/transcripts-cli.js [<botId/file-id>]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.TRANSCRIPTS_DIR || "data/transcripts";
if (!existsSync(dir)) {
  console.log(`No transcripts yet (${dir} does not exist).`);
  process.exit(0);
}

interface Entry {
  type: string;
  ts: string;
  [key: string]: string;
}
const read = (path: string): Entry[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Entry);

const files = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(join(dir, d.name))
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ name: `${d.name}/${f.replace(/\.jsonl$/, "")}`, path: join(dir, d.name, f) })),
  )
  .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs);

const wanted = process.argv[2];
if (!wanted) {
  for (const f of files) {
    const entries = read(f.path);
    const contact = entries.find((e) => e.type === "contact");
    const count = entries.filter((e) => e.type === "message").length;
    const last = entries.at(-1)?.ts.slice(0, 16).replace("T", " ");
    const who = contact ? `${contact.name} <${contact.email}>` : "(no contact details)";
    console.log(`${last}  ${String(count).padStart(3)} msgs  ${who}\n    ${f.name}`);
  }
  console.log(`\n${files.length} conversation(s).`);
} else {
  const matches = files.filter((f) => f.name.includes(wanted));
  if (matches.length !== 1) {
    console.error(matches.length ? `Matches ${matches.length} conversations - be more specific:\n${matches.map((m) => "  " + m.name).join("\n")}` : "No conversation matches.");
    process.exit(1);
  }
  for (const e of read(matches[0]!.path)) {
    if (e.type === "contact") {
      console.log(`Name:        ${e.name}\nEmail:       ${e.email}\nPhone:       ${e.phone || "-"}\nDescription: ${e.description || "-"}\nWebsite:     ${e.origin || "-"}\nStarted:     ${e.ts}\n${"-".repeat(60)}`);
    } else {
      console.log(`[${e.ts.slice(0, 19).replace("T", " ")}] ${e.role === "user" ? "Visitor" : "Bot"}: ${e.text}\n`);
    }
  }
}
