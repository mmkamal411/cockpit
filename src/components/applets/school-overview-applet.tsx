"use client";

import { useCallback, useEffect, useState } from "react";
import { openApplet } from "@/lib/applet-bus";

// ---------------------------------------------------------------------------
// Types — mirror the /api/crew/members/[id]/school-overview payload.
// ---------------------------------------------------------------------------
interface ClassCard {
  id: string;
  name: string;
  full_name: string;
  teacher: string | null;
  grade: number | null;
  letter: string | null;
  gap_to_90: number | null;
  on_track: boolean;
  missing_count: number;
  upcoming_count: number;
  total_assignments: number;
}

interface OverviewStats {
  class_count: number;
  on_track_count: number;
  needs_work_count: number;
  avg_grade: number | null;
  missing_count: number;
  upcoming_count: number;
}

interface Priority {
  id: string;
  kind: "missing" | "upcoming";
  title: string;
  class_name: string;
  due: string | null;
  category: string | null;
  why: string;
  done: boolean;
}

interface OverviewPayload {
  member: { id: string; name: string };
  synced_at: string | null;
  classes: ClassCard[];
  stats: OverviewStats | null;
  priorities: Priority[];
  message?: string;
}

interface CrewMemberRow {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function relativeTime(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ageMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} hr ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

function dueLabel(due: string | null): string {
  if (!due) return "No due date";
  return `Due ${due}`;
}

/** Shame-free status copy. */
function statusCopy(c: ClassCard): { text: string; tone: "ok" | "work" } {
  if (c.grade === null) return { text: "Not graded yet", tone: "work" };
  if (c.on_track) return { text: "On track", tone: "ok" };
  return { text: `${(c.gap_to_90 ?? 0).toFixed(1)} to go`, tone: "work" };
}

/**
 * School Overview — every class at a glance, top priorities, all driven by
 * the latest school sync. Reads the school-overview API (server-side merge of
 * crew_grade_syncs + Path-to-90 checkbox state). Nothing here is stored in
 * the browser; marking a priority done persists via the path-to-90 API.
 */
export function SchoolOverviewApplet({
  params,
}: {
  params?: { memberId?: string };
}) {
  const [memberId, setMemberId] = useState<string | null>(
    params?.memberId ?? null,
  );
  const [memberName, setMemberName] = useState("");
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      // Resolve the crew member: explicit param wins, else the first one.
      let id = params?.memberId ?? null;
      if (!id) {
        const res = await fetch("/api/crew/members");
        if (res.status === 401) {
          setLoadError("signed-out");
          return;
        }
        const json = await res.json();
        const members: CrewMemberRow[] = json.members ?? [];
        if (members.length === 0) {
          setLoadError("no-crew");
          return;
        }
        id = members[0].id;
      }
      setMemberId(id);
      const res = await fetch(`/api/crew/members/${id}/school-overview`);
      if (res.status === 401) {
        setLoadError("signed-out");
        return;
      }
      const json: OverviewPayload = await res.json();
      if (!res.ok) throw new Error(json.message ?? "load failed");
      setMemberName(json.member?.name ?? "");
      setData(json);
    } catch {
      setLoadError("Couldn't load school data right now. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [params?.memberId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Mark a priority done — persists server-side via Path-to-90. */
  async function togglePriority(p: Priority) {
    if (!memberId || toggling) return;
    setToggling(p.id);
    const nextDone = !p.done;
    setData((prev) =>
      prev
        ? {
            ...prev,
            priorities: prev.priorities.map((x) =>
              x.id === p.id ? { ...x, done: nextDone } : x,
            ),
          }
        : prev,
    );
    try {
      const fullName = data?.classes.find((c) => c.name === p.class_name)?.full_name;
      await fetch(`/api/crew/members/${memberId}/path-to-90`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_name: p.class_name,
          action_id: `weekly-priority:${fullName ?? p.class_name}::${p.title}`,
          checked: nextDone,
        }),
      });
    } catch {
      // Best effort — revert on failure so the UI stays honest.
      setData((prev) =>
        prev
          ? {
              ...prev,
              priorities: prev.priorities.map((x) =>
                x.id === p.id ? { ...x, done: !nextDone } : x,
              ),
            }
          : prev,
      );
    } finally {
      setToggling(null);
    }
  }

  // -- Loading skeleton (never a blank page) -------------------------------
  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading school overview">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">
            School
          </p>
          <h2 className="mt-1 text-xl font-semibold text-star">School overview</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-panel-2" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-panel-2" />
          ))}
        </div>
      </div>
    );
  }

  // -- Signed out -----------------------------------------------------------
  if (loadError === "signed-out") {
    return (
      <div className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">
          School
        </p>
        <h2 className="text-xl font-semibold text-star">School overview</h2>
        <p className="text-sm text-stardust">
          Sign in to see school data.
        </p>
        <button
          type="button"
          onClick={() => openApplet("more", {}, { replace: true })}
          className="rounded-lg bg-neon-cyan/15 px-4 py-2 text-sm font-medium text-neon-cyan ring-1 ring-neon-cyan/40 hover:bg-neon-cyan/25"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  // -- No crew member --------------------------------------------------------
  if (loadError === "no-crew") {
    return (
      <div className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">
          School
        </p>
        <h2 className="text-xl font-semibold text-star">School overview</h2>
        <p className="text-sm leading-relaxed text-stardust">
          No one is on your crew yet. Add a crew member to start tracking
          their school life.
        </p>
        <button
          type="button"
          onClick={() => openApplet("crew", {}, { replace: true })}
          className="rounded-lg bg-neon-cyan/15 px-4 py-2 text-sm font-medium text-neon-cyan ring-1 ring-neon-cyan/40 hover:bg-neon-cyan/25"
        >
          Add a crew member
        </button>
      </div>
    );
  }

  // -- Load failure ----------------------------------------------------------
  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">
          School
        </p>
        <h2 className="text-xl font-semibold text-star">School overview</h2>
        <p className="text-sm leading-relaxed text-stardust">{loadError}</p>
        <button
          type="button"
          onClick={load}
          className="rounded-lg bg-neon-cyan/15 px-4 py-2 text-sm font-medium text-neon-cyan ring-1 ring-neon-cyan/40 hover:bg-neon-cyan/25"
        >
          Try again
        </button>
      </div>
    );
  }

  // -- No school data yet ----------------------------------------------------
  if (!data || data.classes.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">
          School
        </p>
        <h2 className="text-xl font-semibold text-star">
          {memberName ? `${memberName}'s school` : "School overview"}
        </h2>
        <p className="text-sm leading-relaxed text-stardust">
          {data?.message ??
            "No school data yet — connect a school login or tap SYNC NOW."}
        </p>
        <button
          type="button"
          onClick={() => openApplet("crew", {}, { replace: true })}
          className="rounded-lg bg-neon-cyan/15 px-4 py-2 text-sm font-medium text-neon-cyan ring-1 ring-neon-cyan/40 hover:bg-neon-cyan/25"
        >
          Open Crew to connect school
        </button>
      </div>
    );
  }

  const stats = data.stats!;
  const statTiles = [
    {
      label: "On track",
      value: String(stats.on_track_count),
      sub: `of ${stats.class_count} classes at 90+`,
      tone: "text-neon-teal",
    },
    {
      label: "Needs work",
      value: String(stats.needs_work_count),
      sub: "classes below 90",
      tone: "text-neon-amber",
    },
    {
      label: "Missing work",
      value: String(stats.missing_count),
      sub: "past due, no score yet",
      tone: stats.missing_count > 0 ? "text-neon-amber" : "text-neon-teal",
    },
    {
      label: "Coming up",
      value: String(stats.upcoming_count),
      sub: "not yet turned in",
      tone: "text-neon-cyan",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">
            School
          </p>
          <h2 className="mt-1 text-xl font-semibold text-star">
            {memberName ? `${memberName}'s overview` : "School overview"}
          </h2>
          <p className="mt-1 text-xs text-dim">
            {data.synced_at
              ? `Last synced ${relativeTime(data.synced_at)}`
              : "Sync time unknown"}
            {stats.avg_grade !== null && (
              <span className="text-stardust">
                {" "}· Average {stats.avg_grade.toFixed(1)}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-lg bg-panel-3 px-3 py-1.5 text-xs font-medium text-stardust ring-1 ring-line hover:text-star"
        >
          Refresh
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="list" aria-label="School stats">
        {statTiles.map((t) => (
          <div
            key={t.label}
            role="listitem"
            className="rounded-xl bg-panel-2 p-4 ring-1 ring-line"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-dim">
              {t.label}
            </p>
            <p className={`mt-1 text-2xl font-semibold ${t.tone}`}>{t.value}</p>
            <p className="mt-0.5 text-xs text-stardust">{t.sub}</p>
          </div>
        ))}
      </div>

      {/* Class grid */}
      <section aria-labelledby="school-classes">
        <h3
          id="school-classes"
          className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-dim"
        >
          Classes
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.classes.map((c) => {
            const st = statusCopy(c);
            const gapPct =
              c.gap_to_90 === null ? 0 : Math.min(100, Math.max(0, (90 - c.gap_to_90) / 90 * 100));
            return (
              <article
                key={c.id}
                className="rounded-xl bg-panel-2 p-4 ring-1 ring-line"
                aria-label={`${c.name}, grade ${c.grade ?? "not graded yet"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-star" title={c.full_name}>
                      {c.name}
                    </h4>
                    {c.teacher && (
                      <p className="mt-0.5 truncate text-xs text-dim">{c.teacher}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${
                      st.tone === "ok"
                        ? "bg-neon-teal/10 text-neon-teal ring-neon-teal/30"
                        : "bg-neon-amber/10 text-neon-amber ring-neon-amber/30"
                    }`}
                  >
                    {st.text}
                  </span>
                </div>

                <div className="mt-3 flex items-baseline gap-2">
                  <p className="text-3xl font-semibold text-star">
                    {c.grade === null ? "—" : c.grade.toFixed(1)}
                  </p>
                  <span className="text-dim" aria-hidden="true">|</span>
                  <p className="text-xl font-medium text-stardust">
                    {c.letter ?? "—"}
                  </p>
                </div>

                {/* Gap-to-90 progress */}
                <div className="mt-2">
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-panel-3"
                    role="progressbar"
                    aria-valuenow={Math.round(gapPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Progress to 90 for ${c.name}`}
                  >
                    <div
                      className={`h-full rounded-full ${
                        st.tone === "ok" ? "bg-neon-teal" : "bg-neon-amber"
                      }`}
                      style={{ width: `${gapPct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-dim">
                    {c.gap_to_90 === null
                      ? "Waiting on grades"
                      : c.gap_to_90 <= 0
                        ? "At or above the 90 goal"
                        : `${c.gap_to_90.toFixed(1)} points to the 90 goal`}
                  </p>
                </div>

                <div className="mt-3 flex gap-3 text-xs text-stardust">
                  <span>
                    <span className={c.missing_count > 0 ? "font-medium text-neon-amber" : ""}>
                      {c.missing_count}
                    </span>{" "}
                    missing
                  </span>
                  <span>
                    <span className={c.upcoming_count > 0 ? "font-medium text-neon-cyan" : ""}>
                      {c.upcoming_count}
                    </span>{" "}
                    upcoming
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Weekly priorities */}
      <section aria-labelledby="weekly-priorities">
        <h3
          id="weekly-priorities"
          className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-dim"
        >
          This week&apos;s priorities
        </h3>
        {data.priorities.length === 0 ? (
          <div className="rounded-xl bg-panel-2 p-4 ring-1 ring-line">
            <p className="text-sm text-stardust">
              Nothing urgent on the board — no missing work and nothing due
              soon. Nice work keeping it clean.
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {data.priorities.map((p, idx) => (
              <li
                key={p.id}
                className={`flex gap-3 rounded-xl bg-panel-2 p-4 ring-1 ring-line ${
                  p.done ? "opacity-60" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => togglePriority(p)}
                  disabled={toggling === p.id}
                  aria-pressed={p.done}
                  aria-label={p.done ? `Mark "${p.title}" as not done` : `Mark "${p.title}" as done`}
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 transition ${
                    p.done
                      ? "bg-neon-teal/20 text-neon-teal ring-neon-teal/50"
                      : "text-transparent ring-line hover:ring-neon-teal/60"
                  }`}
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M3 8.5l3.5 3.5L13 4.5" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                        p.kind === "missing"
                          ? "bg-neon-amber/10 text-neon-amber ring-neon-amber/30"
                          : "bg-neon-cyan/10 text-neon-cyan ring-neon-cyan/30"
                      }`}
                    >
                      {idx + 1}. {p.kind === "missing" ? "Missing" : "Upcoming"}
                    </span>
                    <span className="text-xs text-dim">{p.class_name}</span>
                  </div>
                  <p
                    className={`mt-1 text-sm font-medium ${
                      p.done ? "text-dim line-through" : "text-star"
                    }`}
                  >
                    {p.title}
                  </p>
                  <p className="mt-0.5 text-xs text-stardust">{p.why}</p>
                  <p className="mt-1 text-[11px] text-dim">
                    {dueLabel(p.due)}
                    {p.category ? ` · ${p.category}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
