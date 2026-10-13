"use client";

import { useMemo, useState } from "react";

/** One parsed district-calendar row (from crew_school_calendar_events). */
export interface DistrictCalEvent {
  title: string;
  event_date: string; // YYYY-MM-DD
  end_date: string | null;
  /** The district's category (e.g. "Holiday - School Closed"), when known. */
  category: string | null;
}

interface CategoryStyle {
  dot: string;
  label: string;
}

/**
 * Category → dot color + legend label. Matches the district calendar legend:
 * green First/Last Day, orange Digital Learning, gray Board Meeting,
 * red Holiday (Closed), purple Conference Week, blue Student Holiday,
 * orange-red Early Release.
 */
const CATEGORY_STYLES: { keys: string[]; dot: string; label: string }[] = [
  {
    keys: ["first and last days of school", "first day", "last day"],
    dot: "#059669",
    label: "First / Last Day",
  },
  {
    keys: ["digital learning"],
    dot: "#d97706",
    label: "Digital Learning",
  },
  {
    keys: ["board meeting"],
    dot: "#94a3b8",
    label: "Board Meeting",
  },
  {
    keys: ["holiday - school closed", "school closed", "holidays"],
    dot: "#e11d48",
    label: "Holiday (Closed)",
  },
  {
    keys: ["conference week"],
    dot: "#9333ea",
    label: "Conference Week",
  },
  {
    keys: ["student holiday", "holiday"],
    dot: "#2563eb",
    label: "Student Holiday",
  },
  {
    keys: ["early release"],
    dot: "#ea580c",
    label: "Early Release",
  },
];

export function styleForCategory(category: string | null, title: string): CategoryStyle {
  const haystack = `${category ?? ""} ${title}`.toLowerCase();
  for (const c of CATEGORY_STYLES) {
    if (c.keys.some((k) => haystack.includes(k))) {
      return { dot: c.dot, label: c.label };
    }
  }
  return { dot: "#71717a", label: category ?? "Event" };
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function toDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Events covering a given day (inclusive of multi-day ranges). */
export function eventsOnDay(events: DistrictCalEvent[], key: string): DistrictCalEvent[] {
  return events.filter((e) => e.event_date <= key && key <= (e.end_date ?? e.event_date));
}

/** "2026–27" style school-year label for the calendar subtitle. */
export function schoolYearLabel(year: number, month: number): string {
  const startYear = month >= 6 ? year : year - 1; // July starts the school year
  return `${startYear}–${String(startYear + 1).slice(2)}`;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * District school calendar — month grid with color-coded event dots,
 * per-day event detail, and a legend. Ported from the Pookie app's
 * cobb-calendar component, restyled for the Cockpit dark deck.
 * Collapsed by default; only real event rows are ever shown.
 */
export function DistrictCalendar({
  events,
  districtName,
  sourceUrl,
}: {
  events: DistrictCalEvent[];
  districtName: string | null;
  sourceUrl: string | null;
}) {
  const todayKey = useMemo(() => toDayKey(new Date()), []);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selectedEvents = useMemo(
    () => (selectedKey ? eventsOnDay(events, selectedKey) : []),
    [events, selectedKey],
  );

  const legend = useMemo(() => {
    const seen = new Map<string, CategoryStyle>();
    for (const e of events) {
      const s = styleForCategory(e.category, e.title);
      if (!seen.has(s.label)) seen.set(s.label, s);
    }
    return [...seen.values()];
  }, [events]);

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = first.getDay();
    const arr: { date: Date; inMonth: boolean; key: string }[] = [];
    for (let i = 0; i < 42; i++) {
      const dayNum = i - startOffset + 1;
      const date = new Date(viewYear, viewMonth, dayNum);
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      arr.push({
        date,
        inMonth: dayNum >= 1 && dayNum <= daysInMonth,
        key: toDayKey(date),
      });
    }
    return arr;
  }, [viewYear, viewMonth]);

  function goMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    while (m > 11) {
      m -= 12;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
    setSelectedKey(null);
  }

  function goToday() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedKey(toDayKey(now));
  }

  const selectedDate = selectedKey ? parseKey(selectedKey) : null;
  const title = districtName ? `${districtName} Calendar` : "School District Calendar";

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel-2/60">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-star">{title}</span>
          <span className="block text-xs text-dim">
            {districtName ? `${districtName} · ` : ""}
            {schoolYearLabel(viewYear, viewMonth)} · tap to {open ? "hide" : "view"}
          </span>
        </span>
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
          className={`shrink-0 text-dim transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-line">
          {/* Month navigation */}
          <div className="flex items-center justify-between px-3 py-2.5">
            <button
              type="button"
              onClick={() => goMonth(-1)}
              aria-label="Previous month"
              className="rounded-full p-2 text-stardust transition hover:bg-white/[0.06] hover:text-star active:scale-90"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="text-center">
              <p className="text-base font-bold text-star">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </p>
              <p className="text-[11px] text-dim">
                {districtName ?? "School District"} · {schoolYearLabel(viewYear, viewMonth)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => goMonth(1)}
              aria-label="Next month"
              className="rounded-full p-2 text-stardust transition hover:bg-white/[0.06] hover:text-star active:scale-90"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 px-2">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-dim"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5 px-2 pb-2" role="grid" aria-label="District calendar month grid">
            {cells.map(({ date, inMonth, key }) => {
              const dayEvents = eventsOnDay(events, key);
              const isToday = key === todayKey;
              const isSelected = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(isSelected ? null : key)}
                  aria-label={`${MONTH_NAMES[date.getMonth()]} ${date.getDate()}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ""}`}
                  aria-pressed={isSelected}
                  className={`relative flex min-h-[44px] flex-col items-center justify-start rounded-xl pt-1.5 transition ${
                    inMonth ? "text-star" : "text-dim/40"
                  } ${
                    isSelected
                      ? "bg-neon-green/20 text-star"
                      : isToday
                        ? "bg-white/[0.06]"
                        : "hover:bg-white/[0.05] active:bg-white/[0.08]"
                  }`}
                >
                  <span
                    className={`flex size-7 items-center justify-center rounded-full text-[13px] font-semibold ${
                      isToday && !isSelected ? "ring-2 ring-neon-cyan" : ""
                    } ${isSelected ? "ring-2 ring-neon-green" : ""}`}
                  >
                    {date.getDate()}
                  </span>
                  {dayEvents.length > 0 && (
                    <span className="flex items-center gap-[3px] pb-1 pt-0.5" aria-hidden="true">
                      {dayEvents.slice(0, 3).map((e, i) => (
                        <span
                          key={`${e.title}-${i}`}
                          className="size-1.5 rounded-full"
                          style={{ background: styleForCategory(e.category, e.title).dot }}
                        />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected day detail */}
          {selectedKey && (
            <div className="border-t border-line px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-star">
                  {selectedDate?.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                <button
                  type="button"
                  onClick={goToday}
                  className="shrink-0 rounded-full border border-line bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-star transition hover:bg-white/[0.08]"
                >
                  Today
                </button>
              </div>
              {selectedEvents.length === 0 ? (
                <p className="mt-2 text-sm text-dim">
                  Regular school day — nothing special on the district calendar.
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {selectedEvents.map((e, i) => {
                    const s = styleForCategory(e.category, e.title);
                    const multiDay = e.end_date && e.end_date !== e.event_date;
                    return (
                      <li
                        key={`${e.title}-${e.event_date}-${i}`}
                        className="flex items-start gap-2.5 rounded-xl border border-line bg-white/[0.03] px-3 py-2.5"
                      >
                        <span
                          className="mt-1.5 size-2.5 shrink-0 rounded-full"
                          style={{ background: s.dot }}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-snug text-star">{e.title}</p>
                          {multiDay && (
                            <p className="mt-0.5 text-[11px] text-dim">
                              {parseKey(e.event_date).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                              {" – "}
                              {parseKey(e.end_date!).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </p>
                          )}
                        </div>
                        <span
                          className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold"
                          style={{
                            borderColor: `${s.dot}66`,
                            color: s.dot,
                            background: `${s.dot}14`,
                          }}
                        >
                          {s.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Legend */}
          {legend.length > 0 && (
            <div className="border-t border-line bg-white/[0.02] px-4 py-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-dim">
                Legend
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {legend.map((s) => (
                  <span
                    key={s.label}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-stardust"
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: s.dot }}
                      aria-hidden="true"
                    />
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Source attribution */}
          {sourceUrl && (
            <p className="border-t border-line px-4 py-2.5 text-xs text-dim">
              Source:{" "}
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-neon-green underline transition-opacity hover:opacity-80"
              >
                {domainOf(sourceUrl)} ↗
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
