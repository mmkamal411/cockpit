"use client";

import { useEffect, useRef, useState } from "react";
import {
  detectPersona,
  flipConfirmation,
  PERSONA_LABEL,
  stripDirective,
  type Persona,
} from "@/lib/chat/mode";
import { parseSSEFrame } from "@/lib/chat/sse";

const TUTOR_URL = (
  process.env.NEXT_PUBLIC_CRYSTAL_URL ||
  process.env.NEXT_PUBLIC_POOKIE_TUTOR_URL ||
  ""
).replace(/\/$/, "");

/**
 * Server API path (POST /api/chat) — the browser stops calling the worker
 * directly (spec §5). Flag-gated: the client-direct path stays the default
 * until /api/chat is verified working end-to-end.
 */
const SERVER_MODE = process.env.NEXT_PUBLIC_CHAT_SERVER_API === "1";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Which persona answered (assistant messages only). */
  persona?: Persona;
  /** System note (mode flip confirmations) — rendered as a subtle line. */
  note?: boolean;
}

interface ThreadSummary {
  id: string;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

const SUGGESTIONS = [
  "What should I focus on today?",
  "Help me plan my week",
  "Remind me to drink water",
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Night watch";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function greetingMessage(): ChatMessage {
  return {
    role: "assistant",
    persona: "crystal",
    text: `${greeting()}. I'm Crystal — your co-pilot. Tell me what's on your mind and I'll help you run the day.`,
  };
}

/** Tappable mode pill — shows which persona answered, flips the mode. */
function ModePill({
  persona,
  onFlip,
}: {
  persona: Persona;
  onFlip: () => void;
}) {
  const isCrystal = persona === "crystal";
  return (
    <button
      type="button"
      onClick={onFlip}
      title={isCrystal ? "Switch to Fireball (direct mode)" : "Switch to Crystal (warm mode)"}
      aria-label={`${PERSONA_LABEL[persona]} mode — tap to switch to ${isCrystal ? "Fireball" : "Crystal"}`}
      className={`mb-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
        isCrystal
          ? "border-neon-teal/40 bg-neon-teal/10 text-neon-teal hover:bg-neon-teal/20"
          : "border-neon-amber/40 bg-neon-amber/10 text-neon-amber hover:bg-neon-amber/20"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          isCrystal ? "bg-neon-teal" : "bg-neon-amber"
        }`}
      />
      {PERSONA_LABEL[persona]}
    </button>
  );
}

/** Crystal — the pilot's AI co-pilot. Warm by default, Fireball on keyword. */
export function CrystalApplet() {
  const [messages, setMessages] = useState<ChatMessage[]>([greetingMessage()]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceDown, setVoiceDown] = useState(!TUTOR_URL && !SERVER_MODE);
  /** Sticky mode — keyword flips persist until the pilot flips back. */
  const [mode, setMode] = useState<Persona>("crystal");
  /** Thread persistence (server mode only). */
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [todayId, setTodayId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [threadSearch, setThreadSearch] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  // Load today's thread on open (server mode).
  useEffect(() => {
    if (!SERVER_MODE) return;
    let cancelled = false;
    (async () => {
      const list = await fetchThreads();
      if (cancelled || !list) return;
      if (list.today_id) {
        setLoadingThread(true);
        const loaded = await fetchThread(list.today_id);
        setLoadingThread(false);
        if (cancelled) return;
        if (loaded && loaded.length > 0) setMessages(loaded);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Flip the mode with a one-line confirmation (spec §7). */
  function flipMode(next?: Persona) {
    const target: Persona = next ?? (mode === "crystal" ? "fireball" : "crystal");
    if (target === mode) return;
    setMode(target);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", note: true, persona: target, text: flipConfirmation(target) },
    ]);
    if (SERVER_MODE) {
      // Best-effort: the pill flip already happened locally.
      fetch("/api/chat/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: target }),
      }).catch(() => {});
    }
  }

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || sending) return;
    setDraft("");
    setSending(true);
    const persona = detectPersona(clean);
    const outbound = stripDirective(clean, persona);
    // Keyword flips are sticky: update the mode with a confirmation line.
    const flipped = persona !== mode;
    if (flipped) {
      setMode(persona);
      if (SERVER_MODE) {
        fetch("/api/chat/mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: persona }),
        }).catch(() => {});
      }
    }
    // UI shows what the pilot typed; the worker gets the directive stripped.
    const userMsg: ChatMessage = { role: "user", text: clean };
    const history = [...messages, userMsg];
    const workerHistory = [...messages, { ...userMsg, text: outbound }];
    setMessages(flipped ? [...history, flipNote(persona)] : history);

    try {
      if (SERVER_MODE) {
        await sendViaServer(persona, outbound);
      } else {
        await sendDirect(workerHistory, persona);
      }
    } finally {
      setSending(false);
    }
  }

  /** Server path: POST /api/chat — context assembled server-side, thread
   *  persisted, reply streamed back over SSE (spec §3). */
  async function sendViaServer(persona: Persona, outbound: string) {
    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          thread_id: threadId,
          message: outbound,
          mode: persona,
          stream: true,
        }),
      });
    } catch {
      throw new Error("chat unreachable");
    }
    if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);
    // Placeholder bubble that fills in as SSE chunks arrive.
    setMessages((prev) => [...prev, { role: "assistant", text: "", persona }]);
    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let fullText = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const parsed = parseSSEFrame(`${frame}\n\n`);
          if (!parsed) continue;
          if (typeof parsed["delta"] === "string") {
            const delta = parsed["delta"] as string;
            fullText += (fullText ? " " : "") + delta;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  text: last.text ? `${last.text} ${delta}` : delta,
                };
              }
              return next;
            });
          }
          if (parsed["done"] === true) {
            if (typeof parsed["thread_id"] === "string") setThreadId(parsed["thread_id"]);
            if (parsed["mode"] === "fireball" || parsed["mode"] === "crystal") {
              const replyPersona = parsed["mode"] as Persona;
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, persona: replyPersona };
                }
                return next;
              });
            }
          }
        }
      }
      if (!fullText.trim()) throw new Error("empty stream");
      void fetchThreads();
    } catch {
      // Stream broke mid-flight: drop the placeholder and fall back to the
      // direct worker path so chat never breaks.
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && !last.text) next.pop();
        return next;
      });
      const workerHistory = [...messages, { role: "user" as const, text: outbound }];
      await sendDirect(workerHistory, persona);
    }
  }

  /** Direct browser → worker path (legacy; stays until /api/chat is verified). */
  async function sendDirect(
    workerHistory: ChatMessage[],
    persona: Persona,
  ) {
    if (!TUTOR_URL) {
      setVoiceDown(true);
      return;
    }
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${TUTOR_URL}/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: workerHistory.slice(-20).map((m) => ({ role: m.role, text: m.text })),
          context: { pilot: true },
          mode: persona,
        }),
      });
      window.clearTimeout(timer);
      if (!res.ok) throw new Error(`tutor ${res.status}`);
      const data = (await res.json()) as { reply?: unknown };
      const reply = typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : "";
      if (!reply) throw new Error("empty reply");
      setMessages((prev) => [...prev, { role: "assistant", text: reply, persona }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "I went quiet for a moment — check your connection and try again. I'm still here.", persona },
      ]);
    }
  }

  // ---- thread drawer -------------------------------------------------------

  async function fetchThreads(): Promise<{ threads: ThreadSummary[]; today_id: string | null } | null> {
    try {
      const res = await fetch("/api/chat/threads");
      if (!res.ok) return null;
      const data = (await res.json()) as {
        threads?: ThreadSummary[];
        today_id?: string | null;
      };
      const list = Array.isArray(data.threads) ? data.threads : [];
      setThreads(list);
      setTodayId(data.today_id ?? null);
      return { threads: list, today_id: data.today_id ?? null };
    } catch {
      return null;
    }
  }

  async function fetchThread(id: string): Promise<ChatMessage[] | null> {
    try {
      const res = await fetch(`/api/chat/threads/${id}`);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        thread?: { id: string };
        messages?: { role: string; text: string; persona: string | null }[];
      };
      if (!data.thread) return null;
      setThreadId(data.thread.id);
      return (data.messages ?? []).map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        text: m.text,
        persona: m.persona === "fireball" ? ("fireball" as const) : m.role === "assistant" ? ("crystal" as const) : undefined,
      }));
    } catch {
      return null;
    }
  }

  async function openThread(id: string) {
    setLoadingThread(true);
    const loaded = await fetchThread(id);
    setLoadingThread(false);
    if (loaded) {
      setMessages(loaded.length > 0 ? loaded : [greetingMessage()]);
      setDrawerOpen(false);
    }
  }

  async function newThread() {
    try {
      const res = await fetch("/api/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { thread?: { id: string } };
      if (data.thread) {
        setThreadId(data.thread.id);
        setMessages([greetingMessage()]);
        setDrawerOpen(false);
        void fetchThreads();
      }
    } catch {
      /* drawer stays open */
    }
  }

  async function togglePin(t: ThreadSummary) {
    try {
      const res = await fetch(`/api/chat/threads/${t.id}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !t.pinned }),
      });
      if (res.ok) void fetchThreads();
    } catch {
      /* no-op */
    }
  }

  async function deleteThread(id: string) {
    try {
      const res = await fetch(`/api/chat/threads/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      if (id === threadId) {
        setThreadId(null);
        setMessages([greetingMessage()]);
      }
      void fetchThreads();
    } catch {
      /* no-op */
    }
  }

  const visibleThreads = threads.filter((t) =>
    threadSearch.trim()
      ? t.title.toLowerCase().includes(threadSearch.trim().toLowerCase())
      : true,
  );

  return (
    <div className="flex min-h-[320px] flex-col">
      {SERVER_MODE && (
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setDrawerOpen((v) => !v);
              if (!drawerOpen) void fetchThreads();
            }}
            aria-expanded={drawerOpen}
            className="rounded-full border border-line bg-panel-2/60 px-3 py-1 text-xs text-stardust transition-colors hover:border-neon-teal/40 hover:text-star"
          >
            {drawerOpen ? "Close conversations" : "Conversations"}
          </button>
          <span className="ml-auto">
            <ModePill persona={mode} onFlip={() => flipMode()} />
          </span>
        </div>
      )}

      {SERVER_MODE && drawerOpen && (
        <div className="mb-3 rounded-xl border border-line bg-panel-2/50 p-3">
          <div className="mb-2 flex gap-2">
            <input
              value={threadSearch}
              onChange={(e) => setThreadSearch(e.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs text-star placeholder:text-dim focus:border-neon-teal/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={newThread}
              className="shrink-0 rounded-lg border border-neon-teal/40 bg-neon-teal/10 px-3 py-1.5 text-xs font-medium text-neon-teal hover:bg-neon-teal/20"
            >
              New
            </button>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {visibleThreads.length === 0 && (
              <p className="px-1 py-2 text-xs text-dim">
                {threadSearch ? "No conversations match." : "No conversations yet."}
              </p>
            )}
            {visibleThreads.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors ${
                  t.id === threadId ? "bg-neon-teal/10 text-star" : "text-stardust hover:bg-panel-2"
                }`}
              >
                <button
                  type="button"
                  onClick={() => openThread(t.id)}
                  className="min-w-0 flex-1 truncate text-left"
                  title={t.title}
                >
                  {t.pinned && <span aria-hidden>📌 </span>}
                  {t.title}
                  {t.id === todayId && (
                    <span className="ml-2 rounded-full bg-neon-teal/15 px-1.5 py-0.5 text-[10px] text-neon-teal">
                      today
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => togglePin(t)}
                  aria-label={t.pinned ? "Unpin conversation" : "Pin conversation"}
                  title={t.pinned ? "Unpin" : "Pin"}
                  className="shrink-0 rounded px-1 text-dim hover:text-star"
                >
                  {t.pinned ? "★" : "☆"}
                </button>
                <button
                  type="button"
                  onClick={() => deleteThread(t.id)}
                  aria-label="Delete conversation"
                  title="Delete"
                  className="shrink-0 rounded px-1 text-dim hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 space-y-3">
        {loadingThread && (
          <p className="text-center text-xs text-dim">Loading conversation…</p>
        )}
        {!loadingThread &&
          messages.map((m, i) =>
            m.note ? (
              <p key={i} className="text-center text-[11px] uppercase tracking-widest text-dim">
                {m.text}
              </p>
            ) : (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-neon-teal/15 text-star ring-1 ring-neon-teal/30"
                      : "border border-line bg-panel-2/70 text-stardust"
                  }`}
                >
                  {m.role === "assistant" && m.persona && (
                    <ModePill persona={m.persona} onFlip={() => flipMode()} />
                  )}
                  <div>{m.text}</div>
                </div>
              </div>
            ),
          )}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-line bg-panel-2/70 px-4 py-2.5 text-sm text-dim">
              <span className="crystal-typing" aria-label={`${PERSONA_LABEL[mode]} is thinking`}>
                <i /> <i /> <i />
              </span>
            </div>
          </div>
        )}
        {voiceDown && !sending && messages.length > 1 && (
          <p className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-xs leading-relaxed text-stardust">
            Crystal&apos;s voice isn&apos;t connected on this build yet — your words are safe here,
            and the full co-pilot is being wired up.
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length === 1 && !loadingThread && (
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-line bg-panel-2/60 px-3.5 py-1.5 text-xs text-stardust transition-colors hover:border-neon-teal/40 hover:text-star"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send(draft);
          }}
          placeholder={`Ask ${PERSONA_LABEL[mode]} anything…`}
          aria-label={`Ask ${PERSONA_LABEL[mode]} anything`}
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-teal/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => send(draft)}
          disabled={!draft.trim() || sending}
          className="shrink-0 rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2.5 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
      <style>{TYPING_CSS}</style>
    </div>
  );
}

/** One-line confirmation for a keyword-triggered mode flip. */
function flipNote(persona: Persona): ChatMessage {
  return { role: "assistant", note: true, persona, text: flipConfirmation(persona) };
}

const TYPING_CSS = `
.crystal-typing { display: inline-flex; gap: 4px; }
.crystal-typing i {
  width: 6px; height: 6px; border-radius: 9999px;
  background: rgb(167 188 199 / 0.8);
  animation: crystal-typing-blink 1.2s infinite;
}
.crystal-typing i:nth-child(2) { animation-delay: 0.2s; }
.crystal-typing i:nth-child(3) { animation-delay: 0.4s; }
@keyframes crystal-typing-blink {
  0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}
@media (prefers-reduced-motion: reduce) {
  .crystal-typing i { animation: none; opacity: 0.6; }
}
`;
