"use client";

import { useEffect, useState } from "react";
import { newId, readLocal, writeLocal, type GoalItem } from "@/lib/local-store";

const GOALS_KEY = "cockpit.goals";

/** Progress — the pilot's own growth: goals they set, momentum they keep. */
export function ProgressApplet() {
  const [goals, setGoals] = useState<GoalItem[]>(() => readLocal<GoalItem[]>(GOALS_KEY, []));
  const [draft, setDraft] = useState("");

  useEffect(() => {
    writeLocal(GOALS_KEY, goals);
  }, [goals]);

  const done = goals.filter((g) => g.done).length;

  function addGoal() {
    const text = draft.trim();
    if (!text) return;
    setGoals((prev) => [...prev, { id: newId(), text, done: false, createdAt: Date.now() }]);
    setDraft("");
  }

  function toggleGoal(id: string) {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, done: !g.done } : g)));
  }

  function removeGoal(id: string) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-purple">Your growth</p>
        <h2 className="mt-1 text-xl font-semibold text-star">Progress</h2>
        <p className="mt-1 text-sm text-stardust">
          {goals.length === 0
            ? "Set your first goal — small steps, watched over with care."
            : done === goals.length
              ? "Every goal complete. Set the next one — momentum loves company."
              : `${done} of ${goals.length} goals complete. Keep going.`}
        </p>
      </div>

      {goals.length > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-panel-3">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon-purple to-neon-teal transition-all duration-500"
            style={{ width: `${(done / goals.length) * 100}%` }}
          />
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addGoal();
          }}
          placeholder="Name a goal — run a 5K, read 12 books…"
          aria-label="Name a new goal"
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-purple/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={addGoal}
          disabled={!draft.trim()}
          className="shrink-0 rounded-xl border border-neon-purple/40 bg-neon-purple/10 px-4 py-2.5 text-sm font-medium text-neon-purple transition-colors hover:bg-neon-purple/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add goal
        </button>
      </div>

      {goals.length === 0 ? (
        <div className="rounded-2xl border border-line bg-panel-2/60 p-6 text-center">
          <p className="text-sm text-stardust">
            No goals yet. The best time to plant one was yesterday — the second
            best time is right now.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {goals.map((g) => (
            <li
              key={g.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/60 px-4 py-3"
            >
              <button
                type="button"
                onClick={() => toggleGoal(g.id)}
                aria-pressed={g.done}
                aria-label={g.done ? `Reopen goal: ${g.text}` : `Complete goal: ${g.text}`}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  g.done ? "border-neon-green bg-neon-green/20 text-neon-green" : "border-dim/60 text-transparent"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              </button>
              <span className={`min-w-0 flex-1 text-sm ${g.done ? "text-dim line-through" : "text-star"}`}>
                {g.text}
              </span>
              <button
                type="button"
                onClick={() => removeGoal(g.id)}
                aria-label={`Remove goal: ${g.text}`}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-dim transition-colors hover:bg-white/5 hover:text-star"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-dim">Saved on this device. Cloud sync for your goals is being built.</p>
    </div>
  );
}
