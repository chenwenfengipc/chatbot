import { chatLimits } from "./config";

// Best-effort, in-memory limits. They stop casual abuse and runaway loops.
// On serverless hosts each instance has its own memory, so for hard guarantees
// move these counters to a shared store (e.g. Upstash Redis / Vercel KV) and
// set a spending cap in the AI provider's dashboard as the final backstop.

const hits = new Map<string, number[]>();
let day = "";
let dayCount = 0;

export function checkLimits(visitor: string): "ok" | "visitor" | "daily" {
  const now = Date.now();

  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dayCount = 0;
  }
  if (dayCount >= chatLimits.perDay) return "daily";

  const recent = (hits.get(visitor) ?? []).filter((t) => now - t < chatLimits.windowMs);
  if (recent.length >= chatLimits.perVisitor) {
    hits.set(visitor, recent);
    return "visitor";
  }
  recent.push(now);
  hits.set(visitor, recent);
  dayCount++;

  // Keep the map from growing forever.
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (times.every((t) => now - t >= chatLimits.windowMs)) hits.delete(key);
  }
  return "ok";
}
