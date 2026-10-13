"use client";

import { useEffect, useState } from "react";
import type { WeatherDetail, GeoResult } from "@/lib/weather";
import { weatherWords } from "@/lib/weather";

const FALLBACK = { lat: 33.9526, lon: -84.5499, label: "Marietta, GA" };

function iconFor(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 3) return "🌤️";
  if (code <= 48) return "🌫️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌦️";
  return "⛈️";
}

function dayName(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
}

function hourLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric" });
}

/** Weather — the expanded applet: hourly, 7-day, details, location, units. */
export function WeatherApplet() {
  const [units, setUnits] = useState<"F" | "C">("F");
  const [loc, setLoc] = useState(FALLBACK);
  const [detail, setDetail] = useState<(WeatherDetail & { summary: string }) | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const unitLabel = units === "F" ? "F" : "C";

  // Load the pilot's saved location + units once. Falls back to Marietta when
  // signed out or nothing saved — never a blank card.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/weather/location")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.prefs) return;
        const p = d.prefs;
        if (Number.isFinite(p.home_lat) && Number.isFinite(p.home_lon)) {
          setLoc({ lat: p.home_lat, lon: p.home_lon, label: p.home_location || "Home" });
        }
        if (p.weather_units === "F" || p.weather_units === "C") setUnits(p.weather_units);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPrefsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    const controller = new AbortController();
    setFailed(false);
    setDetail(null);
    fetch(
      `/api/weather/detail?lat=${loc.lat}&lon=${loc.lon}&units=${units}`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (!r.ok) throw new Error(`weather ${r.status}`);
        return r.json();
      })
      .then(setDetail)
      .catch((e) => {
        if (e.name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, [loc, units, prefsLoaded, retryCount]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      setSearching(true);
      setSearchFailed(false);
      fetch(`/api/weather/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(d.results ?? []))
        .catch(() => {
          setResults([]);
          setSearchFailed(true);
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  function pickLocation(r: GeoResult) {
    const label = [r.name, r.admin1].filter(Boolean).join(", ");
    setLoc({ lat: r.lat, lon: r.lon, label });
    setQuery("");
    setResults([]);
    // Persist to the pilot row (best effort — works when signed in).
    fetch("/api/weather/location", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ home_location: label, home_lat: r.lat, home_lon: r.lon }),
    }).catch(() => {});
  }

  function toggleUnits() {
    const next = units === "F" ? "C" : "F";
    setUnits(next);
    fetch("/api/weather/location", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weather_units: next }),
    }).catch(() => {});
  }

  return (
    <div className="space-y-6">
      {/* Header: hero + units toggle */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">{loc.label}</p>
          {detail ? (
            <>
              <p className="mt-1 text-5xl font-semibold text-star">
                {detail.temp}°<span className="text-2xl font-normal text-stardust">{unitLabel}</span>
              </p>
              <p className="mt-1 text-sm text-stardust">
                {weatherWords(detail.code)} · Feels like {detail.feelsLike}° · H {detail.high}° / L {detail.low}°
              </p>
              <p className="mt-1 text-sm text-neon-cyan">{detail.summary}</p>
              {detail.stale && (
                <p className="mt-1 text-xs text-dim">
                  Updated {detail.staleMinutes ?? "?"} min ago — showing last good data.
                </p>
              )}
            </>
          ) : failed ? (
            <div>
              <p className="mt-2 text-sm text-stardust">
                The skies are quiet — weather is unavailable right now.
              </p>
              <button
                type="button"
                onClick={() => setRetryCount((n) => n + 1)}
                className="mt-2 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
              >
                Try again
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-dim">Reading the skies…</p>
          )}
        </div>
        <button
          type="button"
          onClick={toggleUnits}
          aria-label={`Switch to degrees ${units === "F" ? "Celsius" : "Fahrenheit"}`}
          className="shrink-0 rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm font-medium text-stardust transition-colors hover:border-neon-cyan/40 hover:text-star"
        >
          °{unitLabel} ⇄
        </button>
      </div>

      {/* Hourly strip */}
      {detail && detail.hourly.length > 0 && (
        <section aria-label="Next 24 hours">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">Next 24 hours</h3>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
            {detail.hourly.map((h) => (
              <div
                key={h.time}
                className="flex w-16 shrink-0 flex-col items-center rounded-xl border border-line bg-panel-2/60 px-2 py-3"
              >
                <span className="text-[11px] text-dim">{hourLabel(h.time)}</span>
                <span aria-hidden="true" className="my-1 text-xl">{iconFor(h.code)}</span>
                <span className="text-sm font-medium text-star">{h.temp}°</span>
                {h.precipChance >= 20 && (
                  <span className="mt-0.5 text-[11px] text-neon-cyan">{h.precipChance}%</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 7-day list */}
      {detail && detail.daily.length > 0 && (
        <section aria-label="7-day forecast">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">7-day forecast</h3>
          <ul className="mt-2 space-y-1.5">
            {detail.daily.map((d, i) => (
              <li
                key={d.date}
                className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/60 px-4 py-2.5"
              >
                <span className="w-12 text-sm font-medium text-stardust">
                  {i === 0 ? "Today" : dayName(d.date)}
                </span>
                <span aria-hidden="true" className="text-xl">{iconFor(d.code)}</span>
                <span className="ml-auto text-sm text-star">
                  <span className="font-medium">{d.high}°</span>
                  <span className="text-dim"> / {d.low}°</span>
                </span>
                {d.precipChance >= 20 && (
                  <span className="w-10 text-right text-xs text-neon-cyan">{d.precipChance}%</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Details grid */}
      {detail && (
        <section aria-label="Details">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">Details</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              ["Wind", `${detail.windMph} mph`],
              ["Humidity", `${detail.humidity}%`],
              ["Sunrise", detail.sunrise ? new Date(detail.sunrise).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—"],
              ["Sunset", detail.sunset ? new Date(detail.sunset).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-dim">{label}</p>
                <p className="mt-0.5 text-sm font-medium text-star">{value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Location picker */}
      <section aria-label="Change location">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">Location</h3>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search city or ZIP…"
          aria-label="Search city or ZIP"
          className="mt-2 w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
        />
        {searching && <p className="mt-1 text-xs text-dim">Searching…</p>}
        {searchFailed && results.length === 0 && (
          <p className="mt-1 text-xs text-stardust">
            The place search isn't working right now — try again in a bit.
          </p>
        )}
        {results.length > 0 && (
          <ul className="mt-2 space-y-1">
            {results.map((r, i) => (
              <li key={`${r.lat},${r.lon},${i}`}>
                <button
                  type="button"
                  onClick={() => pickLocation(r)}
                  className="w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-left text-sm text-star transition-colors hover:border-neon-cyan/40"
                >
                  {r.name}{r.admin1 ? `, ${r.admin1}` : ""}{r.country ? ` · ${r.country}` : ""}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-dim">Coarse location only — your precise whereabouts are never tracked.</p>
      </section>
    </div>
  );
}
