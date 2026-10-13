"use client";

import { useCallback, useEffect, useState } from "react";
import { TodoApplet } from "./todo-applet";
import type {
  CalendarEvent,
  NudgeItem,
  SchoolItem,
  TodayBriefing,
  TodoItem,
} from "@/lib/today-types";

const REFRESH_MS = 60_000;

/** Today — the pilot's attention and agenda for right now.
 *
 * READ-ONLY briefing surface (overdue, schedule, due today, nudges, school)
 * composed server-side at /api/today. The rich to-do manager below it is
 * TodoApplet — lists, sharing, recurrence, reminders, Google Tasks sync.
 */
export function TodayApplet({ params }: { params?: Record<string, string> }) {
  const [briefing, setBriefing] = useState<TodayBriefing | null>(null);
  const [briefingError, setBriefingError] = useState<string | null>(null);
  // True when the pilot's sign-in lapsed: retrying can't fix it, so the
  // error panel offers a sign-in link instead of a useless "Try again".
  const [briefingAuthExpired, setBriefingAuthExpired] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const loadBriefing = useCallback(async () => {
    setBriefingError(null);
    setBriefingAuthExpired(false);
    try {
      const res = await fetch("/api/today", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 401) {
          setBriefingAuthExpired(true);
          setBriefingError(
            "Your sign-in has expired, so today's briefing can't load. Sign in again and it'll be right here.",
          );
          return;
        }
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

  // The server computes the briefing day in the pilot's own timezone;
  // prefer that over the device's local date so the header never
  // disagrees with the sections below it.
  const dateLine = (() => {
    const iso = briefing?.date;
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    }
    return new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  })();

  const attention =
    (briefing?.counts.overdue ?? 0) +
    (briefing?.counts.dueToday ?? 0) +
    (briefing?.counts.events ?? 0) +
    (briefing?.counts.nudges ?? 0) +
    (briefing?.counts.school ?? 0);

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
        authExpired={briefingAuthExpired}
        onRetry={loadBriefing}
      />

      {/* Rich to-do manager: lists, sharing, recurrence, reminders,
          Google Tasks sync, Crystal breakdown. The invite flow can deep-link
          a freshly shared list via the applet params. */}
      <TodoApplet initialListId={typeof params?.list === "string" ? params.list : undefined} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Briefing sections                                                   */
/* ------------------------------------------------------------------ */

/** "due yesterday" / "due 3 days ago" / "due Oct 5" — plain words, not date math. */
function overdueLabel(dueAt: number | null | undefined): string {
  if (typeof dueAt !== "number" || Number.isNaN(dueAt)) return "overdue";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(dueAt))) / 86_400_000);
  if (days <= 1) return "due yesterday";
  if (days < 7) return `due ${days} days ago`;
  return `due ${new Date(dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function BriefingSections({
  briefing,
  error,
  authExpired,
  onRetry,
}: {
  briefing: TodayBriefing | null;
  error: string | null;
  authExpired: boolean;
  onRetry: () => void;
}) {
  if (error !== null) {
    return (
      <div className="rounded-2xl border border-line bg-panel-2/60 p-5 text-center">
        <p className="text-sm text-stardust">{error}</p>
        {authExpired ? (
          <a
            href="/login"
            className="mt-3 inline-block rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
          >
            Sign in
          </a>
        ) : (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
          >
            Try again
          </button>
        )}
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
              <span className="ml-2 text-xs text-red-400/80">{overdueLabel(t.dueAt)}</span>
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
                {e.allDay
                  ? "All day"
                  : new Date(e.startAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-star">{e.title}</span>
                {e.location ? (
                  <span className="block truncate text-xs text-dim">{e.location}</span>
                ) : null}
              </span>
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
            <li
              key={`${s.crewMemberId}-${s.text}-${s.dueAt ?? ""}`}
              className="rounded-lg border border-line bg-panel-2/60 px-3 py-2"
            >
              <p className="text-sm text-star">{s.text}</p>
              <p className="mt-0.5 text-xs text-dim">
                {s.crewMemberName}
                {typeof s.dueAt === "number"
                  ? ` · due ${new Date(s.dueAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}`
                  : null}
              </p>
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
