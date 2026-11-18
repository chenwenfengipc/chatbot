import { limits } from "./config.js";

// Best-effort, in-memory limits. They stop casual abuse and runaway loops.
// With more than one server instance, move these counters to a shared store
// (e.g. Redis) and set a spending cap in the AI provider's dashboard as the
// final backstop.

const hits = new Map<string, number[]>();
const days = new Map<string, { day: string; count: number }>();

export function checkLimits(botId: string, userKey: string): "ok" | "user" | "daily" {
  const now = Date.now();

  const today = new Date(now).toISOString().slice(0, 10);
  let daily = days.get(botId);
  if (!daily || daily.day !== today) days.set(botId, (daily = { day: today, count: 0 }));
  if (daily.count >= limits.perDay) return "daily";

  const key = `${botId}:${userKey}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < limits.windowMs);
  if (recent.length >= limits.perUser) {
    hits.set(key, recent);
    return "user";
  }
  recent.push(now);
  hits.set(key, recent);
  daily.count++;

  // Keep the map from growing forever.
  if (hits.size > 5000) {
    for (const [k, times] of hits) if (times.every((t) => now - t >= limits.windowMs)) hits.delete(k);
  }
  return "ok";
}
