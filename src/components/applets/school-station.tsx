"use client";

import { useEffect, useMemo, useState } from "react";
import { openApplet } from "@/lib/applet-bus";
import { useCrewRoster, type CrewRosterMember } from "@/lib/use-crew-roster";

interface SchoolClass {
  id: string;
  name: string;
  grade: number | null;
  letter: string | null;
  gap_to_90: number | null;
}

interface UpcomingItem {
  assignment: string;
  due: string | null;
  class: string | null;
}

interface SchoolMessage {
  source: "synergy" | "outlook";
  sender: string | null;
  subject: string | null;
  preview: string | null;
  date: string | null;
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

/**
 * Honest note for a section that isn't built yet. Plain English, no jargon —
 * and never the word "syncing" for something that isn't syncing.
 */
function ComingSoonNote({ title, body }: { title: string; body: string }) {
  return (
    <section aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
      <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
        <p className="text-sm text-stardust">Coming soon</p>
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

const DAY_MS = 86_400_000;

/**
 * Parse a sync due-date string into a local Date. Syncs write dates like
 * "10/16/2026" or "10/16"; anything else falls back to Date.parse.
 * Returns null when the string carries no usable date.
 */
function parseDue(due: string | null): Date | null {
  if (!due) return null;
  const trimmed = due.trim();
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) {
    const t = Date.parse(trimmed);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  if (year < 100) year += 2000;
  const d = new Date(year, month - 1, day);
  // Guard against rollover (e.g. month 13 or day 40).
  if (Number.isNaN(d.getTime()) || d.getMonth() !== month - 1) return null;
  if (!m[3]) {
    // No year given: school dates belong to this school year, so a date more
    // than a month in the past must mean next year.
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d.getTime() < startOfToday.getTime() - 30 * DAY_MS) {
      d.setFullYear(d.getFullYear() + 1);
    }
  }
  return d;
}

/** Friendly day label for a due date: Today / Tomorrow / "Fri, Oct 17". */
function dueLabel(date: Date): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDue = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfDue.getTime() - startOfToday.getTime()) / DAY_MS);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatMessageDate(date: string | null): string {
  if (!date) return "";
  const t = Date.parse(date);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function messageSourceLabel(source: "synergy" | "outlook"): string {
  return source === "outlook" ? "School email" : "School portal";
}

/**
 * SchoolStation — the parent's one-tap school surface.
 *
 * Section order is deliberate — what matters NOW first, details on demand:
 * NOW strip → Today's mission → Classes (gap-sorted) → This week →
 * Attendance → Check-in status → Messages.
 *
 * Sections with no data source yet (bell schedule, attendance, check-ins)
 * render honest "coming soon" notes — never "syncing", never blank.
 */
export function SchoolStation() {
  const { members, loading: rosterLoading, viewerIsFamilyMember } = useCrewRoster();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [dueNext, setDueNext] = useState<UpcomingItem[]>([]);
  const [messages, setMessages] = useState<SchoolMessage[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [classesSyncedAt, setClassesSyncedAt] = useState<string | null>(null);
  const [classesMessage, setClassesMessage] = useState("");

  const selected: CrewRosterMember | undefined =
    members.find((m) => m.id === selectedId) ?? members[0];

  // Default the picker to the first roster member once the roster resolves.
  // This mirrors the roster into local state on load only — the fetch effect
  // below does the real data work asynchronously.
  useEffect(() => {
    if (!selected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
          setDueNext(Array.isArray(json.due_next) ? json.due_next : []);
          setMessages(Array.isArray(json.messages) ? json.messages : []);
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

  /** Assignments due in the next 7 days (today included), soonest first. */
  const weekItems = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const windowEnd = startOfToday.getTime() + 7 * DAY_MS;
    const seen = new Set<string>();
    return dueNext
      .map((item) => ({ ...item, parsed: parseDue(item.due) }))
      .filter(
        (item): item is UpcomingItem & { parsed: Date } =>
          item.parsed !== null &&
          item.parsed.getTime() >= startOfToday.getTime() &&
          item.parsed.getTime() < windowEnd,
      )
      .filter((item) => {
        const key = `${item.assignment}|${item.due ?? ""}|${item.class ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.parsed.getTime() - b.parsed.getTime());
  }, [dueNext]);

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
    // Family members (children) never see "Add a child" — that's a
    // steward-only action. They get a pointer to their steward instead.
    if (viewerIsFamilyMember) {
      return (
        <div className="space-y-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
            School
          </p>
          <h2 className="text-xl font-semibold text-star">No school life here yet</h2>
          <p className="text-sm leading-relaxed text-stardust">
            Your school life shows up here once your parent links your
            profile — ask them for a link code from their Crew section.
          </p>
        </div>
      );
    }
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
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
        {selected && (
          <button
            type="button"
            onClick={() =>
              openApplet("data-review", { member: selected.id })
            }
            className="shrink-0 rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2 text-xs font-semibold text-neon-teal transition-colors hover:bg-neon-teal/20"
          >
            Data review
          </button>
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

      {/* 1 · Right now — bell schedule isn't wired up yet, so say so plainly. */}
      <ComingSoonNote
        title="Right now"
        body="The bell schedule isn't connected yet — once it is, this strip shows what's happening this minute (“3rd period · Geometry · ends 10:42”)."
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

      {/* 4 · This week — real 7-day due scan from the latest sync's due_next */}
      <section aria-label="This week">
        <SectionTitle>This week</SectionTitle>
        {classesLoading ? (
          <p className="text-sm text-stardust">Reading the week ahead…</p>
        ) : stillSyncing ? (
          <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
            <p className="text-sm text-stardust">
              {`Still syncing ${selected?.name ?? "your child"}'s school data — upcoming assignments will appear here as soon as the first sync lands.`}
            </p>
          </div>
        ) : classesMessage ? (
          <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
            <p className="text-sm text-stardust">{classesMessage}</p>
          </div>
        ) : weekItems.length === 0 ? (
          <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
            <p className="text-sm text-stardust">
              Nothing due in the next 7 days — enjoy the calm.
            </p>
          </div>
        ) : (
          <ol className="space-y-2">
            {weekItems.map((item) => (
              <li
                key={`${item.assignment}|${item.due ?? ""}|${item.class ?? ""}`}
                className="flex items-center gap-3 rounded-2xl border border-line bg-panel-2/60 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-star">
                    {item.assignment}
                  </span>
                  {item.class && (
                    <span className="mt-0.5 block truncate text-xs text-dim">
                      {item.class}
                    </span>
                  )}
                </span>
                <span className="shrink-0 rounded-full border border-neon-green/30 bg-neon-green/[0.07] px-2.5 py-1 text-xs font-medium text-neon-green">
                  {dueLabel(item.parsed)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 5 · Attendance — no attendance view yet, so say so plainly. */}
      <ComingSoonNote
        title="Attendance"
        body="Coming soon — we're still building the attendance view. Absences and tardies will show here once it lands."
      />

      {/* 6 · Check-in — daily check-ins aren't switched on yet, so say so plainly. */}
      <ComingSoonNote
        title="Check-in"
        body="Coming soon — daily check-ins aren't switched on yet. Once they are, you'll see the week's rhythm here (“checked in 4 of 5 days”) plus the themes your child flagged."
      />

      {/* 7 · Messages — teacher mail from the latest sync (Synergy + school email) */}
      <section aria-label="Messages">
        <SectionTitle>Messages</SectionTitle>
        {classesLoading ? (
          <p className="text-sm text-stardust">Reading messages…</p>
        ) : stillSyncing ? (
          <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
            <p className="text-sm text-stardust">
              {`Still syncing ${selected?.name ?? "your child"}'s school data — teacher messages will appear here as soon as the first sync lands.`}
            </p>
          </div>
        ) : classesMessage ? (
          <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
            <p className="text-sm text-stardust">{classesMessage}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
            <p className="text-sm text-stardust">No teacher messages right now.</p>
          </div>
        ) : (
          <ol className="space-y-2">
            {messages.map((m, i) => {
              const from = m.sender ?? messageSourceLabel(m.source);
              const sentOn = formatMessageDate(m.date);
              return (
                <li
                  key={`${m.source}|${m.date ?? ""}|${m.subject ?? ""}|${i}`}
                  className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-star">{from}</p>
                    {sentOn && (
                      <p className="shrink-0 text-xs text-dim">{sentOn}</p>
                    )}
                  </div>
                  {m.subject && (
                    <p className="mt-0.5 truncate text-xs text-stardust">{m.subject}</p>
                  )}
                  {m.preview && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-dim">
                      {m.preview}
                    </p>
                  )}
                  <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-dim">
                    {messageSourceLabel(m.source)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
