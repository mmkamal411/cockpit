"use client";

import { useCallback, useEffect, useState } from "react";
import { newId, readLocal, writeLocal, type TodoItem as LocalTodoItem } from "@/lib/local-store";
import type {
  CalendarEvent,
  NudgeItem,
  SchoolItem,
  TodayBriefing,
  TodoItem,
} from "@/lib/today-types";

const TODOS_KEY = "cockpit.todos";
const REFRESH_MS = 60_000;

/** Today — the pilot's attention and agenda for right now.
 *
 * READ-ONLY briefing surface (overdue, schedule, due today, nudges, school)
 * composed server-side at /api/today. The quick-capture todo list below the
 * briefing is the device-local legacy list; Worker A is migrating todo logic
 * to the shared useTodos() hook — this file only restructures around it.
 */
export function TodayApplet() {
  const [briefing, setBriefing] = useState<TodayBriefing | null>(null);
  const [briefingError, setBriefingError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [todos, setTodos] = useState<LocalTodoItem[]>(() => readLocal<LocalTodoItem[]>(TODOS_KEY, []));
  const [draft, setDraft] = useState("");

  useEffect(() => {
    writeLocal(TODOS_KEY, todos);
  }, [todos]);

  const loadBriefing = useCallback(async () => {
    setBriefingError(null);
    try {
      const res = await fetch("/api/today", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Today's briefing didn't load. Please try again.",
        );
      }
      const data = (await res.json()) as TodayBriefing;
      setBriefing(data);
    } catch (err) {
      setBriefingError(
        err instanceof Error ? err.message : "Today's briefing didn't load. Please try again.",
      );
    }
  }, []);

  useEffect(() => {
    loadBriefing();
  }, [loadBriefing, refreshTick]);

  // Refresh the briefing every 60 seconds.
  useEffect(() => {
    const timer = setInterval(() => setRefreshTick((t) => t + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const attention =
    (briefing?.counts.overdue ?? 0) +
    (briefing?.counts.dueToday ?? 0) +
    (briefing?.counts.events ?? 0) +
    (briefing?.counts.nudges ?? 0);

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
          {briefing === null && briefingError === null
            ? "Gathering today's briefing…"
            : attention === 0
              ? "Nothing is asking for you right now. The bridge is quiet."
              : attention === 1
                ? "One thing is asking for your attention."
                : `${attention} things are asking for your attention.`}
        </p>
      </div>

      <BriefingSections
        briefing={briefing}
        error={briefingError}
        onRetry={loadBriefing}
      />

      {/* Device-local quick-capture list (Worker A's migration target — leave intact). */}
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
            Your list is empty. Add the first thing on your mind — Crystal will
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

/* ------------------------------------------------------------------ */
/* Briefing sections                                                   */
/* ------------------------------------------------------------------ */

function BriefingSections({
  briefing,
  error,
  onRetry,
}: {
  briefing: TodayBriefing | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (error !== null) {
    return (
      <div className="rounded-2xl border border-line bg-panel-2/60 p-5 text-center">
        <p className="text-sm text-stardust">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
        >
          Try again
        </button>
      </div>
    );
  }

  if (briefing === null) {
    return (
      <div className="space-y-2" aria-label="Loading today's briefing">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-xl border border-line bg-panel-2/60"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Section
        title="Overdue"
        count={briefing.counts.overdue}
        accent="red"
        emptyLine="Nothing overdue. Clear skies."
        defaultOpen={briefing.counts.overdue > 0}
      >
        <ul className="space-y-1.5">
          {briefing.sections.overdue.map((t: TodoItem) => (
            <li
              key={t.id}
              className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-sm text-star"
            >
              {t.text}
              <span className="ml-2 text-xs text-red-400/80">overdue</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Today's schedule"
        count={briefing.counts.events}
        accent="cyan"
        emptyLine="Nothing on the schedule today."
        defaultOpen={briefing.counts.events > 0}
      >
        <ul className="space-y-1.5">
          {briefing.sections.schedule.map((e: CalendarEvent) => (
            <li key={e.id} className="flex items-baseline gap-3 px-3 py-2">
              <span className="shrink-0 text-xs text-neon-cyan">
                {new Date(e.startAt).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <span className="text-sm text-star">{e.title}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Due today"
        count={briefing.counts.dueToday}
        accent="amber"
        emptyLine="Nothing due today."
        defaultOpen={briefing.counts.dueToday > 0}
      >
        <ul className="space-y-1.5">
          {briefing.sections.dueToday.map((t: TodoItem) => (
            <li key={t.id} className="rounded-lg border border-line bg-panel-2/60 px-3 py-2 text-sm text-star">
              {t.text}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Nudges"
        count={briefing.counts.nudges}
        accent="purple"
        emptyLine="No nudges right now. Crystal is watching."
        defaultOpen={briefing.counts.nudges > 0}
      >
        <ul className="space-y-1.5">
          {briefing.sections.nudges.map((n: NudgeItem) => (
            <li key={n.id} className="rounded-lg border border-line bg-panel-2/60 px-3 py-2">
              <p className="text-sm text-star">{n.text}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-wider text-dim">{n.kind}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="School items"
        count={briefing.counts.school}
        accent="green"
        emptyLine="No school items due today."
        defaultOpen={briefing.counts.school > 0}
      >
        <ul className="space-y-1.5">
          {briefing.sections.school.map((s: SchoolItem) => (
            <li key={`${s.crewMemberId}-${s.text}`} className="rounded-lg border border-line bg-panel-2/60 px-3 py-2">
              <p className="text-sm text-star">{s.text}</p>
              <p className="mt-0.5 text-xs text-dim">{s.crewMemberName}</p>
            </li>
          ))}
        </ul>
      </Section>

      {briefing.counts.handled > 0 && (
        <Section
          title="Handled"
          count={briefing.counts.handled}
          accent="dim"
          emptyLine=""
          defaultOpen={false}
        >
          <ul className="space-y-1.5">
            {briefing.sections.handled.map((h) => (
              <li key={`${h.kind}-${h.id}`} className="px-3 py-1.5 text-sm text-dim line-through">
                {h.text}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {briefing.warnings.length > 0 && (
        <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2">
          {briefing.warnings.map((w, i) => (
            <p key={i} className="text-xs text-dim">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

type Accent = "red" | "cyan" | "amber" | "purple" | "green" | "dim";

const ACCENTS: Record<Accent, { badge: string; border: string }> = {
  red: { badge: "bg-red-400/15 text-red-300", border: "hover:border-red-400/30" },
  cyan: { badge: "bg-neon-cyan/15 text-neon-cyan", border: "hover:border-neon-cyan/30" },
  amber: { badge: "bg-amber-400/15 text-amber-300", border: "hover:border-amber-400/30" },
  purple: { badge: "bg-purple-400/15 text-purple-300", border: "hover:border-purple-400/30" },
  green: { badge: "bg-neon-green/15 text-neon-green", border: "hover:border-neon-green/30" },
  dim: { badge: "bg-panel-2 text-dim", border: "hover:border-dim/40" },
};

function Section({
  title,
  count,
  accent,
  emptyLine,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  accent: Accent;
  emptyLine: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const a = ACCENTS[accent];

  return (
    <div className={`rounded-xl border border-line bg-panel-2/40 transition-colors ${a.border}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 text-dim transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="flex-1 text-sm font-medium text-star">{title}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${a.badge}`}>{count}</span>
      </button>
      {open &&
        (count === 0 ? (
          <p className="px-4 pb-3 pl-11 text-sm text-dim">{emptyLine}</p>
        ) : (
          <div className="px-2 pb-3">{children}</div>
        ))}
    </div>
  );
}
