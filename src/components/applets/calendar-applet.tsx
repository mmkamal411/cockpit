"use client";

import { useEffect, useState } from "react";
import type { Agenda, CalendarEvent } from "@/lib/calendar";

type View = "agenda" | "day" | "week";

interface CalendarConnection {
  id: string;
  provider: string;
  provider_account_email: string | null;
  status: string;
  last_synced_at: string | null;
  last_sync_error?: string | null;
}

function providerLabel(provider: string): string {
  if (provider === "google") return "Google";
  if (provider === "outlook") return "Outlook";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** "Last synced 2h ago" / "Never synced" — plain, no jargon. */
function lastSyncedLabel(iso: string | null): string {
  if (!iso) return "Never synced";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || t <= 0) return "Never synced";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Last synced ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Last synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Last synced yesterday" : `Last synced ${days} days ago`;
}

const CONNECT_BUTTON_CLASS =
  "mt-4 inline-block rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-5 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20";

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

/**
 * Plain-English feedback after an OAuth connect round-trip.
 *
 * NOTE: setState inside the effect is deliberate — the notice is derived from
 * the client-side URL, so it must apply after hydration to avoid an SSR
 * mismatch (the same pattern the agenda loader below already uses).
 */
/* eslint-disable react-hooks/set-state-in-effect */
function CalNotice() {
  const [notice, setNotice] = useState<{ kind: "ok" | "retry"; text: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cal = params.get("cal");
    if (!cal) return;
    if (cal === "connected") {
      setNotice({
        kind: "ok",
        text: "Your calendar is connected — your days will organize themselves here.",
      });
    } else if (cal === "reconsent") {
      setNotice({
        kind: "retry",
        text: "Your calendar needs a fresh permission to keep syncing — reconnect below and approve access to continue.",
      });
    } else if (cal === "error") {
      setNotice({
        kind: "retry",
        text: "That connection didn\u2019t go through. No worries — give it another try below.",
      });
    }
    params.delete("cal");
    const next = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (next ? `?${next}` : ""));
  }, []);

  if (!notice) return null;
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm ${
        notice.kind === "ok"
          ? "border-neon-green/40 bg-neon-green/[0.07] text-star"
          : "border-neon-amber/40 bg-neon-amber/[0.07] text-star"
      }`}
    >
      <p>{notice.text}</p>
      <button
        type="button"
        onClick={() => setNotice(null)}
        aria-label="Dismiss"
        className="shrink-0 rounded-lg px-2 py-0.5 text-dim hover:text-star"
      >
        ✕
      </button>
    </div>
  );
}
/* eslint-enable react-hooks/set-state-in-effect */

/** Connected accounts: provider, account email, sync status, disconnect. */
function ConnectedAccounts({
  connections,
  onChanged,
  onSynced,
}: {
  connections: CalendarConnection[];
  onChanged: () => void;
  onSynced: () => void;
}) {
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect(id: string) {
    setDisconnectingId(id);
    setError(null);
    try {
      const r = await fetch(`/api/calendar/connections/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`disconnect ${r.status}`);
      onChanged();
    } catch {
      setError("Couldn\u2019t disconnect that account — try again in a bit.");
    } finally {
      setDisconnectingId(null);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError(null);
    try {
      const r = await fetch("/api/calendar/sync", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? `sync ${r.status}`);
      if (d.ok === false) {
        const first = Array.isArray(d.errors) && d.errors.length > 0 ? String(d.errors[0]) : null;
        throw new Error(first ?? "The sync didn't finish — try again in a bit.");
      }
      onSynced();
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Couldn't sync right now — try again in a bit.",
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-panel-2/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">Connected accounts</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing}
            className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-2.5 py-1 text-xs font-medium text-neon-cyan hover:bg-neon-cyan/20 disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <a href="/api/calendar/connect" className="rounded-lg border border-line bg-panel-2 px-2.5 py-1 text-xs text-stardust hover:text-star">
            + Google
          </a>
          <a href="/api/calendar/connect/outlook" className="rounded-lg border border-line bg-panel-2 px-2.5 py-1 text-xs text-stardust hover:text-star">
            + Outlook
          </a>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {connections.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-star">
                {providerLabel(c.provider)}
                {c.status !== "active" && (
                  <span className="ml-2 text-xs font-normal text-neon-amber">(needs attention)</span>
                )}
              </p>
              {c.provider_account_email && (
                <p className="truncate text-xs text-dim">{c.provider_account_email}</p>
              )}
              <p className="mt-0.5 text-xs text-dim">{lastSyncedLabel(c.last_synced_at)}</p>
              {c.last_sync_error && (
                <p className="mt-0.5 text-xs text-neon-amber">{c.last_sync_error}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => disconnect(c.id)}
              disabled={disconnectingId === c.id}
              className="shrink-0 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs text-stardust hover:text-star disabled:opacity-50"
            >
              {disconnectingId === c.id ? "Removing…" : "Disconnect"}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-xs text-neon-amber">{error}</p>
      )}
    </div>
  );
}

/** Calendar — AI-organized agenda, day, and week views. */
export function CalendarApplet() {
  const [view, setView] = useState<View>("agenda");
  const [dayOffset, setDayOffset] = useState(0);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connections, setConnections] = useState<CalendarConnection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const dayISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  })();

  async function loadConnections() {
    try {
      const r = await fetch("/api/calendar/connections");
      if (!r.ok) throw new Error(`connections ${r.status}`);
      const d = await r.json();
      setConnections(d.connections ?? []);
    } catch {
      setConnections([]);
    }
  }

  useEffect(() => {
    loadConnections();
  }, []);

  /** After a manual sync: refresh the accounts list and re-pull the view. */
  function handleSynced() {
    loadConnections();
    setReloadKey((k) => k + 1);
  }

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
  }, [view, dayISO, reloadKey]);

  const dayLabel = new Date(dayISO + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div className="space-y-5">
      <CalNotice />
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
          <p className="text-sm font-medium text-star">Your calendar isn&apos;t connected yet.</p>
          <p className="mt-1 text-sm text-stardust">Connect a calendar and your days will organize themselves here.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a href="/api/calendar/connect" className={CONNECT_BUTTON_CLASS}>
              Connect Google Calendar
            </a>
            <a href="/api/calendar/connect/outlook" className={CONNECT_BUTTON_CLASS}>
              Connect Outlook
            </a>
          </div>
        </div>
      ) : failed ? (
        <p className="text-sm text-stardust">Couldn&apos;t load your calendar right now — try again in a bit.</p>
      ) : view === "agenda" ? (
        agenda ? (
          <div className="space-y-5">
            {connections !== null && connections.length > 0 && (
              <ConnectedAccounts connections={connections} onChanged={loadConnections} onSynced={handleSynced} />
            )}
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
        <div className="space-y-5">
          {connections !== null && connections.length > 0 && (
            <ConnectedAccounts connections={connections} onChanged={loadConnections} onSynced={handleSynced} />
          )}
          <ul className="space-y-2">
            {events.map((e) => <EventRow key={e.id} e={e} />)}
            {events.length === 0 && <p className="text-sm text-stardust">Nothing on the books.</p>}
          </ul>
        </div>
      )}
    </div>
  );
}
