"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { siteConfig } from "@/site.config";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = ["What's the difference between the plans?", "Do you have a free product?", "How do I book a demo?"];

// Messages live only in this component's memory: nothing is written to the
// browser (no cookies / storage), so closing or reloading the page clears the chat.
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    const history: Msg[] = [...messages, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    const setReply = (content: string) =>
      setMessages((m) => [...m.slice(0, -1), { role: "assistant", content }]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setReply(
          res.status === 429
            ? "You're sending messages quickly - please wait a few minutes, or email us."
            : `Our assistant is unavailable right now. Please [contact us](/contact) or email ${siteConfig.email}.`,
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setReply(reply);
      }
      if (!reply.trim()) setReply("Sorry, I couldn't come up with an answer. Please [contact us](/contact).");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setReply("Connection problem - please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground shadow-lg transition hover:opacity-90"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.3A8 8 0 1 1 21 12Z" />
          </svg>
          Ask us
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={`${siteConfig.name} assistant`}
          className="fixed inset-x-3 bottom-3 z-50 flex h-[min(34rem,calc(100vh-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96"
        >
          <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
            <div>
              <p className="text-sm font-semibold">{siteConfig.name} assistant</p>
              <p className="text-xs text-muted">AI assistant - answers may be inaccurate</p>
            </div>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-lg leading-none text-muted hover:bg-border">
              ×
            </button>
          </header>

          <div role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
            <Bubble role="assistant">
              Hi! I can answer questions about our products and pricing. What would you like to know?
            </Bubble>

            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {STARTERS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    className="rounded-full border border-border px-3 py-1.5 text-left text-xs hover:bg-surface"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <Bubble key={i} role={m.role}>
                {m.content ? renderText(m.content) : <span className="text-muted">Typing…</span>}
              </Bubble>
            ))}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="border-t border-border p-3"
          >
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={1000}
                placeholder="Type your question…"
                aria-label="Your message"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
              >
                Send
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted">
              Please don&apos;t share passwords or sensitive data. Messages are processed by an AI provider -{" "}
              <Link href="/legal/privacy-policy" className="underline">
                see our Privacy Policy
              </Link>
              .
            </p>
          </form>
        </div>
      )}
    </>
  );
}

function Bubble({ role, children }: { role: Msg["role"]; children: ReactNode }) {
  return (
    <div className={role === "user" ? "flex justify-end" : "flex justify-start"}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 leading-relaxed ${
          role === "user" ? "bg-accent text-accent-foreground" : "bg-surface"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// Minimal, safe renderer: **bold** and [text](/site-path or mailto:) links only.
// Anything else (including external URLs) stays plain text, so the model can't
// inject arbitrary links or markup.
function renderText(text: string): ReactNode[] {
  return text.split(/(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*)/g).map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith("/") && !href.startsWith("//")) {
        return (
          <Link key={i} href={href} className="font-medium underline">
            {label}
          </Link>
        );
      }
      if (href.startsWith("mailto:")) {
        return (
          <a key={i} href={href} className="font-medium underline">
            {label}
          </a>
        );
      }
      return label;
    }
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    return bold ? <strong key={i}>{bold[1]}</strong> : part;
  });
}
