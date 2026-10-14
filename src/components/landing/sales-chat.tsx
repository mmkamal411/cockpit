"use client";

import { useEffect, useRef, useState } from "react";

/** Sales-support chat bubble for the landing page.
 *
 *  Answers come from a built-in FAQ — this is a guide, not an AI. The
 *  widget says so in its header, and never pretends to understand more
 *  than its topic list. */

interface QaEntry {
  topics: string[];
  answer: string;
}

const QA: QaEntry[] = [
  {
    topics: ["cost", "price", "free", "pay", "subscription", "plan"],
    answer:
      "Crystal is free to board right now — no credit card, no trial clock. If we ever add paid plans, current pilots will hear about it first.",
  },
  {
    topics: ["what", "do", "feature", "features", "can it", "task", "school", "health", "money", "calendar", "email"],
    answer:
      "Crystal keeps your day in one calm cockpit: tasks and shopping lists, school grades and assignments, health habits, bills and subscriptions, and your messages — with proactive nudges before things slip.",
  },
  {
    topics: ["privacy", "private", "data", "secure", "security", "sell", "track", "advertis"],
    answer:
      "Your data stays yours. We never sell personal information, nothing you teach Crystal leaks into anyone else's account, and you can delete your data any time from Settings. See our Privacy Policy in the footer for the full picture.",
  },
  {
    topics: ["kid", "child", "children", "parent", "family", "teen"],
    answer:
      "Crystal is your personal assistant — signup never asks about children. If you do have kids, the Family features are an optional module you can add later; they're never required.",
  },
  {
    topics: ["sign", "account", "login", "start", "begin", "join"],
    answer:
      "Tap \"Sign up free\" up top: enter your email and we send a 6-digit code, or continue with Google. No password to remember — the same code signs you back in later.",
  },
  {
    topics: ["device", "phone", "mobile", "app", "browser", "ios", "android", "desktop"],
    answer:
      "Crystal runs in your browser — phone, tablet, or desktop — so there's nothing to install. Your cockpit syncs across all of them.",
  },
  {
    topics: ["ai", "smart", "intelligent", "robot", "assistant"],
    answer:
      "Crystal is an AI co-pilot powered by a real language model. She learns your rhythms over time — but only from your account, never from anyone else's. (Psst — I'm just the landing-page guide answering from a FAQ, not Crystal herself.)",
  },
  {
    topics: ["help", "support", "contact", "problem", "issue", "human"],
    answer:
      "Once you're signed in, there's a full Support section — Help Center, AI support chat, and tickets with real people. On the landing page, our legal docs in the footer answer most policy questions.",
  },
];

const FALLBACK =
  "I can answer the basics: what Crystal does, pricing, privacy, signing up, devices, or support. Try asking one of those — or scroll the page, most answers are there.";

interface Message {
  role: "user" | "guide";
  text: string;
}

const SUGGESTED = [
  "What can Crystal do?",
  "Is it free?",
  "Is my data private?",
  "Do I need kids to use it?",
];

function findAnswer(input: string): string {
  const words = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return FALLBACK;
  let best: { entry: QaEntry; score: number } | null = null;
  for (const entry of QA) {
    let score = 0;
    for (const topic of entry.topics) {
      if (words.some((w) => w === topic || (w.length > 3 && topic.startsWith(w)) || (topic.length > 3 && w.startsWith(topic)))) {
        score += 1;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { entry, score };
  }
  return best ? best.entry.answer : FALLBACK;
}

export function SalesChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "guide",
      text: "Hi, I'm the Crystal guide — quick answers from our FAQ (not an AI, just the basics). What can I tell you?",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  function ask(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setMessages((m) => [...m, { role: "user", text: clean }, { role: "guide", text: findAnswer(clean) }]);
    setInput("");
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div
          role="dialog"
          aria-label="Crystal guide chat"
          className="flex h-[420px] w-[320px] flex-col overflow-hidden rounded-2xl border border-line bg-panel/95 shadow-[0_24px_80px_rgb(0_0_0/0.6)] backdrop-blur-xl sm:w-[360px]"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-star">Crystal guide</p>
            <p className="text-[11px] text-dim">
              Quick answers from our FAQ — not an AI, just the basics.
            </p>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <p
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-md bg-neon-teal/20 px-3.5 py-2 text-sm leading-relaxed text-star"
                      : "max-w-[85%] rounded-2xl rounded-bl-md bg-white/[0.06] px-3.5 py-2 text-sm leading-relaxed text-stardust"
                  }
                >
                  {m.text}
                </p>
              </div>
            ))}
          </div>
          {messages.length === 1 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] text-stardust transition-colors hover:border-neon-teal/40 hover:text-neon-teal"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="border-t border-line p-3"
          >
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="sales-chat-input">
                Ask the guide a question
              </label>
              <input
                id="sales-chat-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about Crystal…"
                maxLength={300}
                className="flex-1 rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-star placeholder:text-dim focus:border-neon-teal/60 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-xl border border-neon-teal/50 bg-neon-teal/15 px-3.5 py-2 text-sm font-semibold text-star transition-colors hover:bg-neon-teal/25"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close the Crystal guide chat" : "Open the Crystal guide chat"}
        className="flex h-14 w-14 items-center justify-center rounded-full border border-neon-teal/50 bg-panel/90 text-2xl shadow-[0_0_28px_rgb(94_234_212/0.3)] backdrop-blur-md transition-transform hover:scale-105"
      >
        <span aria-hidden="true">{open ? "✕" : "?"}</span>
      </button>
    </div>
  );
}
