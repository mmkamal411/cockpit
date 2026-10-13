"use client";

import { useEffect, useState } from "react";
import { openApplet } from "@/lib/applet-bus";
import { useCrewRoster, type CrewRosterMember } from "@/lib/use-crew-roster";

interface SchoolClass {
  id: string;
  name: string;
  grade: number | null;
  letter: string | null;
  gap_to_90: number | null;
}

/** Amber never red — grades are mission framing, never judgment. */
function gradeTone(grade: number | null): string {
  if (grade === null) return "text-dim";
  if (grade >= 90) return "text-neon-green";
  if (grade >= 80) return "text-star";
  return "text-neon-amber";
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-dim">
      {children}
    </h3>
  );
}

/** Honest placeholder for data the sync hasn't delivered yet. */
function SyncingCard({ title, body }: { title: string; body: string }) {
  return (
    <section aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
      <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
        <p className="text-sm text-stardust">Syncing…</p>
        <p className="mt-1 text-xs leading-relaxed text-dim">{body}</p>
      </div>
    </section>
  );
}

function GapBar({ gap }: { gap: number }) {
  const width = Math.min(100, Math.max(4, (gap / 30) * 100));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
      role="img"
      aria-label={`${gap.toFixed(1)} points to the 90 goal`}
    >
      <div
        className="h-full rounded-full bg-neon-amber/80"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/**
 * SchoolStation — the parent's one-tap school surface (Phase A).
 *
 * Section order is deliberate — what matters NOW first, details on demand:
 * NOW strip → Today's mission → Classes (gap-sorted) → This week →
 * Attendance → Check-in status → Messages.
 *
 * school_schedules / district_calendars / checkins don't exist yet, so those
 * sections render honest "syncing…" states instead of pretending or blanking.
 */
export function SchoolStation() {
  const { members, loading: rosterLoading } = useCrewRoster();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [classesSyncedAt, setClassesSyncedAt] = useState<string | null>(null);
  const [classesMessage, setClassesMessage] = useState("");

  const selected: CrewRosterMember | undefined =
    members.find((m) => m.id === selectedId) ?? members[0];

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function load() {
      setClassesLoading(true);
      setClassesMessage("");
      try {
        const res = await fetch(`/api/crew/members/${selected!.id}/classes`);
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setClasses(Array.isArray(json.classes) ? json.classes : []);
          setClassesSyncedAt(json.synced_at ?? null);
          if (json.message) setClassesMessage(json.message);
        } else {
          setClassesMessage("Couldn't load classes right now.");
        }
      } catch {
        if (!cancelled) setClassesMessage("Couldn't load classes right now.");
      } finally {
        if (!cancelled) setClassesLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (rosterLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
          School
        </p>
        <p className="text-sm text-stardust">Reading the school station…</p>
      </div>
    );
  }

  if (members.length === 0) {
    // Defensive — the School tab only renders with ≥1 linked child, but a
    // direct applet open shouldn't ever blank.
    return (
      <div className="space-y-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
          School
        </p>
        <h2 className="text-xl font-semibold text-star">No school life here yet</h2>
        <p className="text-sm leading-relaxed text-stardust">
          Link a child to see their school life — grades, missions, and
          today&apos;s rhythm, all in one place.
        </p>
        <button
          type="button"
          onClick={() => openApplet("crew", {}, { replace: true })}
          className="rounded-xl border border-neon-green/40 bg-neon-green/10 px-5 py-2.5 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
        >
          Add a child
        </button>
      </div>
    );
  }

  const gapClasses = classes
    .filter((c) => typeof c.gap_to_90 === "number" && (c.gap_to_90 as number) > 0)
    .sort((a, b) => (b.gap_to_90 as number) - (a.gap_to_90 as number));
  const mission = gapClasses.slice(0, 5);
  const steady = classes.length > 0 && gapClasses.length === 0;
  const stillSyncing =
    classes.length === 0 && !classesLoading && !classesMessage;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
          School
        </p>
        <h2 className="mt-1 text-xl font-semibold text-star">School station</h2>
        {classesSyncedAt && (
          <p className="mt-1 text-xs text-dim">
            Synced{" "}
            {new Date(classesSyncedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}{" "}
            at{" "}
            {new Date(classesSyncedAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        )}
      </div>

      {/* Child picker (only when there's more than one child) */}
      {members.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pick a child">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelectedId(m.id)}
              aria-pressed={selected?.id === m.id}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                selected?.id === m.id
                  ? "border-neon-green/60 bg-neon-green/15 text-star"
                  : "border-line bg-panel-2/60 text-stardust hover:text-star"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

      {/* 1 · NOW strip — bell-schedule aware (table lands in Phase B) */}
      <SyncingCard
        title="Right now"
        body="The bell schedule hasn't synced yet — once it does, this strip shows what's happening this minute (“3rd period · Geometry · ends 10:42”)."
      />

      {/* 2 · Today's mission — gap-sorted, top 5, mission framing */}
      <section aria-label="Today's mission">
        <SectionTitle>Today&apos;s mission</SectionTitle>
        {classesLoading ? (
          <p className="text-sm text-stardust">Reading grades…</p>
        ) : stillSyncing || classesMessage ? (
          <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
            <p className="text-sm text-stardust">
              {stillSyncing
                ? `Still syncing ${selected?.name ?? "your child"}'s school data — the mission will appear here as soon as the first sync lands.`
                : classesMessage}
            </p>
          </div>
        ) : steady ? (
          <div className="rounded-2xl border border-neon-green/25 bg-neon-green/[0.06] px-4 py-3.5">
            <p className="text-sm font-medium text-star">Holding the 90 line</p>
            <p className="mt-1 text-xs leading-relaxed text-stardust">
              Every class is at or above the goal — nothing needs lifting today.
              Grades refresh with each sync; one grade is a snapshot, not a verdict.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {mission.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() =>
                    selected &&
                    openApplet(
                      "class-detail",
                      { member: selected.id, class: c.name },
                      { replace: true },
                    )
                  }
                  aria-label={`Open ${c.name} — ${(c.gap_to_90 as number).toFixed(1)} points to the 90 goal`}
                  className="flex w-full items-center gap-3 rounded-2xl border border-line bg-panel-2/60 px-4 py-3 text-left transition-colors hover:border-neon-amber/40"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neon-amber/40 bg-neon-amber/10 text-xs font-bold text-neon-amber" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-star">{c.name}</span>
                    <span className="mt-0.5 block text-xs text-neon-amber">
                      {(c.gap_to_90 as number).toFixed(1)} points to your goal
                    </span>
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-dim">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 3 · Classes grid — triage-sorted by gap to 90 (parent view) */}
      <section aria-label="Classes">
        <SectionTitle>Classes</SectionTitle>
        {classesLoading ? (
          <p className="text-sm text-stardust">Reading grades…</p>
        ) : classes.length === 0 ? (
          <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
            <p className="text-sm text-stardust">
              {stillSyncing
                ? `Still syncing — ${selected?.name ?? "your child"}'s classes will line up here, sorted by what needs attention first.`
                : (classesMessage || "No class data yet.")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[...classes]
              .sort((a, b) => (b.gap_to_90 ?? -1) - (a.gap_to_90 ?? -1))
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    selected &&
                    openApplet(
                      "class-detail",
                      { member: selected.id, class: c.name },
                      { replace: true },
                    )
                  }
                  aria-label={`Open ${c.name} details`}
                  className="rounded-2xl border border-line bg-panel-2/60 p-4 text-left transition-colors hover:border-neon-green/30"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-star">{c.name}</p>
                    <p className={`shrink-0 text-sm font-semibold ${gradeTone(c.grade)}`}>
                      {c.grade !== null ? c.grade.toFixed(1) : "—"}
                      {c.letter && (
                        <>
                          <span className="mx-1.5 text-dim" aria-hidden="true">|</span>
                          <span className="text-xs font-normal text-dim">{c.letter}</span>
                        </>
                      )}
                    </p>
                  </div>
                  {typeof c.gap_to_90 === "number" && c.gap_to_90 > 0 ? (
                    <div className="mt-2.5 space-y-1">
                      <GapBar gap={c.gap_to_90} />
                      <p className="text-xs text-neon-amber">
                        {c.gap_to_90.toFixed(1)} points to your goal
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2.5 text-xs text-neon-green">At the goal</p>
                  )}
                </button>
              ))}
          </div>
        )}
      </section>

      {/* 4 · This week — 7-day due scan (assignment tables land in Phase B) */}
      <SyncingCard
        title="This week"
        body="The 7-day due scan will fill in here once assignments sync — what's due, and when, at a glance."
      />

      {/* 5 · Attendance — leading indicator (portal data lands in Phase B) */}
      <SyncingCard
        title="Attendance"
        body="Absences and tardies will show here once the school portal syncs them."
      />

      {/* 6 · Check-in status — rhythm framing, not streaks */}
      <SyncingCard
        title="Check-in"
        body="Daily check-ins aren't switched on yet — once they are, you'll see the week's rhythm here (“checked in 4 of 5 days”) plus the themes your child flagged."
      />

      {/* 7 · Messages — teacher inbox + draft approvals (Phase B) */}
      <SyncingCard
        title="Messages"
        body="Teacher messages and draft replies awaiting your OK will live here."
      />
    </div>
  );
}
