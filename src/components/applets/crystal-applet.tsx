"use client";

import { useEffect, useRef, useState } from "react";
import {
  detectPersona,
  flipConfirmation,
  PERSONA_LABEL,
  stripDirective,
  type Persona,
} from "@/lib/chat/mode";

const TUTOR_URL = (
  process.env.NEXT_PUBLIC_CRYSTAL_URL ||
  process.env.NEXT_PUBLIC_POOKIE_TUTOR_URL ||
  ""
).replace(/\/$/, "");

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Which persona answered (assistant messages only). */
  persona?: Persona;
  /** System note (mode flip confirmations) — rendered as a subtle line. */
  note?: boolean;
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: `${greeting()}. I'm Crystal — your co-pilot. Tell me what's on your mind and I'll help you run the day.`, persona: "crystal" },
  ]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceDown, setVoiceDown] = useState(!TUTOR_URL);
  /** Sticky mode — keyword flips persist until the pilot flips back. */
  const [mode, setMode] = useState<Persona>("crystal");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  /** Flip the mode with a one-line confirmation (spec §7). */
  function flipMode(next?: Persona) {
    const target: Persona = next ?? (mode === "crystal" ? "fireball" : "crystal");
    if (target === mode) return;
    setMode(target);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        note: true,
        persona: target,
        text: flipConfirmation(target),
      },
    ]);
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
    if (flipped) setMode(persona);
    // UI shows what the pilot typed; the worker gets the directive stripped.
    const userMsg: ChatMessage = { role: "user", text: clean };
    const history = [...messages, userMsg];
    const workerHistory = [...messages, { ...userMsg, text: outbound }];
    setMessages(flipped ? [...history, flipNote(persona)] : history);

    if (!TUTOR_URL) {
      setSending(false);
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
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-[320px] flex-col">
      <div className="flex-1 space-y-3">
        {messages.map((m, i) =>
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

      {messages.length === 1 && (
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
