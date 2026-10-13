"use client";

import { useEffect, useState } from "react";
import type { Agenda, CalendarEvent } from "@/lib/calendar";

type View = "agenda" | "day" | "week";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function EventRow({ e }: { e: CalendarEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-line bg-panel-2/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-star">{e.title}</span>
          <span className="block text-xs text-dim">
            {e.all_day ? "All day" : `${timeLabel(e.starts_at)} – ${timeLabel(e.ends_at)}`}
            {e.location ? ` · ${e.location}` : ""}
          </span>
        </span>
        <span aria-hidden="true" className="text-dim">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3 text-sm text-stardust">
          {e.description && <p className="whitespace-pre-wrap">{e.description}</p>}
          {e.attendees.length > 0 && (
            <p className="mt-2 text-xs text-dim">
              With: {e.attendees.map((a) => a.name ?? a.email).filter(Boolean).join(", ")}
            </p>
          )}
          <p className="mt-1 text-xs text-dim">On {e.calendar_name}</p>
        </div>
      )}
    </li>
  );
}

/** Calendar — AI-organized agenda, day, and week views. */
export function CalendarApplet() {
  const [view, setView] = useState<View>("agenda");
  const [dayOffset, setDayOffset] = useState(0);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  const dayISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  })();

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    (async () => {
      try {
        if (view === "agenda") {
          const r = await fetch(`/api/calendar/agenda?date=${dayISO}`, { signal: controller.signal });
          if (!r.ok) throw new Error(`agenda ${r.status}`);
          const d = await r.json();
          setConnected(d.connected);
          setAgenda(d.agenda);
        } else {
          const d = new Date(dayISO + "T12:00:00");
          const from = new Date(d); from.setHours(0, 0, 0, 0);
          const to = new Date(d); to.setHours(23, 59, 59, 999);
          if (view === "week") to.setDate(to.getDate() + 6);
          const r = await fetch(
            `/api/calendar/events?from=${from.toISOString()}&to=${to.toISOString()}`,
            { signal: controller.signal },
          );
          if (!r.ok) throw new Error(`events ${r.status}`);
          const data = await r.json();
          setEvents(data.events ?? []);
          setConnected(true);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [view, dayISO]);

  const dayLabel = new Date(dayISO + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl border border-line bg-panel-2 p-1" role="tablist" aria-label="Calendar view">
          {(["agenda", "day", "week"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-sm capitalize transition-colors ${
                view === v ? "bg-neon-cyan/15 text-neon-cyan" : "text-dim hover:text-star"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setDayOffset((o) => o - 1)} aria-label="Previous day"
            className="rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-stardust hover:text-star">‹</button>
          {dayOffset !== 0 && (
            <button type="button" onClick={() => setDayOffset(0)}
              className="rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-stardust hover:text-star">Today</button>
          )}
          <button type="button" onClick={() => setDayOffset((o) => o + 1)} aria-label="Next day"
            className="rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-stardust hover:text-star">›</button>
        </div>
      </div>

      {connected === false ? (
        <div className="rounded-2xl border border-line bg-panel-2/60 p-6 text-center">
          <p className="text-sm font-medium text-star">Your calendar isn't connected yet.</p>
          <p className="mt-1 text-sm text-stardust">Connect Google Calendar and your days will organize themselves here.</p>
          <a
            href="/api/calendar/connect"
            className="mt-4 inline-block rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-5 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
          >
            Connect Google Calendar
          </a>
        </div>
      ) : failed ? (
        <p className="text-sm text-stardust">Couldn't load your calendar right now — try again in a bit.</p>
      ) : view === "agenda" ? (
        agenda ? (
          <div className="space-y-5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">{dayLabel}</p>
              <p className="mt-1 text-sm text-stardust">{agenda.summary}</p>
            </div>
            {agenda.nextUp && (
              <div className="rounded-2xl border border-neon-cyan/30 bg-neon-cyan/[0.06] p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">Next up</p>
                <p className="mt-1 text-base font-semibold text-star">{agenda.nextUp.title}</p>
                <p className="text-sm text-stardust">
                  {agenda.nextUp.all_day ? "All day" : `${timeLabel(agenda.nextUp.starts_at)} – ${timeLabel(agenda.nextUp.ends_at)}`}
                  {agenda.nextUp.location ? ` · ${agenda.nextUp.location}` : ""}
                </p>
              </div>
            )}
            {agenda.sections.map((s) => (
              <section key={s.label} aria-label={s.label}>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">{s.label}</h3>
                <ul className="mt-2 space-y-2">
                  {s.events.map((e) => <EventRow key={e.id} e={e} />)}
                </ul>
              </section>
            ))}
            {agenda.freeWindows.length > 0 && (
              <section aria-label="Free time">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">Open water</h3>
                <ul className="mt-2 space-y-1.5">
                  {agenda.freeWindows.map((w, i) => (
                    <li key={i} className="text-sm text-stardust">
                      Free {timeLabel(w.from)} – {timeLabel(w.to)}
                      <span className="text-dim"> ({w.minutes} min — good focus window)</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {agenda.sections.length === 0 && (
              <p className="text-sm text-stardust">Nothing scheduled — the day is yours.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-dim">Reading your day…</p>
        )
      ) : (
        <ul className="space-y-2">
          {events.map((e) => <EventRow key={e.id} e={e} />)}
          {events.length === 0 && <p className="text-sm text-stardust">Nothing on the books.</p>}
        </ul>
      )}
    </div>
  );
}
