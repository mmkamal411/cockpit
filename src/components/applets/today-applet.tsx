"use client";

import { useEffect, useState } from "react";
import { newId, readLocal, writeLocal, type TodoItem } from "@/lib/local-store";

const TODOS_KEY = "cockpit.todos";

/** Today — the pilot's attention and agenda for right now. */
export function TodayApplet() {
  const [todos, setTodos] = useState<TodoItem[]>(() => readLocal<TodoItem[]>(TODOS_KEY, []));
  const [draft, setDraft] = useState("");

  useEffect(() => {
    writeLocal(TODOS_KEY, todos);
  }, [todos]);

  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const open = todos.filter((t) => !t.done);

  function addTodo() {
    const text = draft.trim();
    if (!text) return;
    setTodos((prev) => [...prev, { id: newId(), text, done: false, createdAt: Date.now() }]);
    setDraft("");
  }

  function toggleTodo(id: string) {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">{dateLine}</p>
        <h2 className="mt-1 text-xl font-semibold text-star">Today&apos;s attention</h2>
        <p className="mt-1 text-sm text-stardust">
          {open.length === 0
            ? "Nothing is asking for you right now. The bridge is quiet."
            : open.length === 1
              ? "One thing is asking for your attention."
              : `${open.length} things are asking for your attention.`}
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTodo();
          }}
          placeholder="Add something to today's list…"
          aria-label="Add something to today's list"
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={addTodo}
          disabled={!draft.trim()}
          className="shrink-0 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {todos.length === 0 ? (
        <div className="rounded-2xl border border-line bg-panel-2/60 p-6 text-center">
          <p className="text-sm text-stardust">
            Your list is empty. Add the first thing on your mind — Pookie will
            keep it in sight all day.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {todos.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => toggleTodo(t.id)}
                aria-pressed={t.done}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-left transition-colors hover:border-neon-cyan/30"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    t.done ? "border-neon-green bg-neon-green/20 text-neon-green" : "border-dim/60 text-transparent"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12.5l5 5L20 6.5" />
                  </svg>
                </span>
                <span className={`text-sm ${t.done ? "text-dim line-through" : "text-star"}`}>{t.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-dim">Saved on this device. Cloud sync for your lists is being built.</p>
    </div>
  );
}
