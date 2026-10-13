"use client";

import { useEffect, useState } from "react";
import { newId, readLocal, writeLocal, type TodoItem } from "@/lib/local-store";
import { openApplet } from "@/lib/applet-bus";

const TODOS_KEY = "cockpit.todos";

// Fallback position when the pilot hasn't shared location — the ship's
// home port label stays honest about it.
const FALLBACK = { lat: 33.9526, lon: -84.5499, label: "Marietta, GA" };

interface Weather {
  temp: number;
  high: number;
  low: number;
  code: number;
  place: string;
  approximate: boolean;
}

function weatherWords(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  return "Stormy";
}

async function fetchWeather(lat: number, lon: number, signal: AbortSignal): Promise<Omit<Weather, "place" | "approximate">> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const data = await res.json();
  return {
    temp: Math.round(data.current.temperature_2m),
    high: Math.round(data.daily.temperature_2m_max[0]),
    low: Math.round(data.daily.temperature_2m_min[0]),
    code: data.current.weather_code,
  };
}

/**
 * GlassPane — the opening-page instrument: local weather, a week strip,
 * and an expandable todo list. Calm glass over the planetary vista.
 */
export function GlassPane() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherFailed, setWeatherFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>(() => readLocal<TodoItem[]>(TODOS_KEY, []));
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let settled = false;
    const load = (lat: number, lon: number, place: string, approximate: boolean) => {
      fetchWeather(lat, lon, controller.signal)
        .then((w) => {
          if (settled || controller.signal.aborted) return;
          settled = true;
          setWeather({ ...w, place, approximate });
        })
        .catch(() => {
          if (settled || controller.signal.aborted) return;
          settled = true;
          setWeatherFailed(true);
        });
    };
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => load(pos.coords.latitude, pos.coords.longitude, "Right here", false),
        () => load(FALLBACK.lat, FALLBACK.lon, FALLBACK.label, true),
        { timeout: 6000, maximumAge: 600000 },
      );
    } else {
      load(FALLBACK.lat, FALLBACK.lon, FALLBACK.label, true);
    }
    return () => controller.abort();
  }, []);

  useEffect(() => {
    writeLocal(TODOS_KEY, todos);
  }, [todos]);

  const now = new Date();
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    const monday = new Date(d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i));
    return monday;
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
    <section
      aria-label="Today at a glance"
      className="glass-pane pointer-events-auto w-full max-w-sm rounded-3xl border border-line bg-panel/55 p-5 shadow-[0_20px_70px_rgb(0_0_0/0.5)] backdrop-blur-xl"
    >
      {/* Weather — tap to open the full applet */}
      <button
        type="button"
        onClick={() => openApplet("weather")}
        aria-label="Open weather details"
        className="flex w-full items-start justify-between gap-3 rounded-2xl text-left transition-colors hover:bg-white/[0.03]"
      >
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-neon-cyan">Weather</p>
          {weather ? (
            <>
              <p className="mt-1 text-3xl font-semibold text-star">
                {weather.temp}°<span className="text-base font-normal text-stardust">F</span>
              </p>
              <p className="mt-0.5 text-xs text-stardust">
                {weatherWords(weather.code)} · {weather.place}
                {weather.approximate ? " (approx.)" : ""} · H {weather.high}° / L {weather.low}°
              </p>
            </>
          ) : weatherFailed ? (
            <p className="mt-1 text-sm text-stardust">The skies are quiet — weather is unavailable right now.</p>
          ) : (
            <p className="mt-1 text-sm text-dim">Reading the skies…</p>
          )}
        </div>
        <span aria-hidden="true" className="text-3xl">
          {weather ? (weather.code <= 3 ? "🌤️" : weather.code <= 67 ? "🌧️" : weather.code <= 77 ? "🌨️" : "⛈️") : "🛰️"}
        </span>
      </button>

      {/* Week strip */}
      <div className="mt-4" aria-label="This week">
        <div className="grid grid-cols-7 gap-1">
          {week.map((d) => {
            const isToday = d.toDateString() === now.toDateString();
            return (
              <div
                key={d.toISOString()}
                className={`flex flex-col items-center rounded-lg py-1.5 ${
                  isToday ? "bg-neon-teal/15 ring-1 ring-neon-teal/40" : ""
                }`}
              >
                <span className={`text-[10px] font-medium ${isToday ? "text-neon-teal" : "text-dim"}`}>
                  {d.toLocaleDateString(undefined, { weekday: "narrow" })}
                </span>
                <span className={`mt-0.5 text-xs ${isToday ? "font-semibold text-star" : "text-stardust"}`}>
                  {d.getDate()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expandable todo list */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="mt-4 flex w-full items-center justify-between rounded-xl border border-line bg-panel-2/50 px-4 py-2.5 text-left transition-colors hover:border-neon-teal/30"
      >
        <span className="text-sm font-medium text-star">
          Todo list
          <span className="ml-2 text-xs font-normal text-dim">
            {open.length === 0 ? "all clear" : `${open.length} open`}
          </span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
          className={`text-stardust transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {todos.length === 0 && (
            <p className="rounded-xl bg-panel-2/50 px-4 py-3 text-xs leading-relaxed text-stardust">
              Nothing on the list. Add the first thing below — it stays in
              sight on Today too.
            </p>
          )}
          <ul className="max-h-44 space-y-1.5 overflow-y-auto">
            {todos.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => toggleTodo(t.id)}
                  aria-pressed={t.done}
                  className="flex w-full items-center gap-2.5 rounded-xl bg-panel-2/50 px-3.5 py-2 text-left transition-colors hover:bg-panel-2"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      t.done ? "border-neon-green bg-neon-green/20 text-neon-green" : "border-dim/60 text-transparent"
                    }`}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12.5l5 5L20 6.5" />
                    </svg>
                  </span>
                  <span className={`text-xs ${t.done ? "text-dim line-through" : "text-star"}`}>{t.text}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTodo();
              }}
              placeholder="Add a todo…"
              aria-label="Add a todo"
              className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3.5 py-2 text-xs text-star placeholder:text-dim focus:border-neon-teal/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={addTodo}
              disabled={!draft.trim()}
              className="shrink-0 rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-3.5 py-2 text-xs font-medium text-neon-teal transition-colors hover:bg-neon-teal/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
