"use client";

import { useEffect, useMemo, useState } from "react";
import { openApplet } from "@/lib/applet-bus";
import { useCrewRoster } from "@/lib/use-crew-roster";
import {
  diffCategories,
  diffGrades,
  diffKeyed,
  diffTitled,
  emptyKind,
  emptyReasonCopy,
  freshnessLine,
  hoursSince,
  prettyKey,
  type AssignmentItem,
  type ReviewField,
  type SyncSnapshot,
} from "@/lib/sync-review";

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
      {children}
    </p>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-dim">
      {children}
    </h3>
  );
}

/** Amber never red — grades are mission framing, never judgment. */
function gradeTone(grade: number | null): string {
  if (grade === null) return "text-dim";
  if (grade >= 90) return "text-neon-green";
  if (grade >= 80) return "text-star";
  return "text-neon-amber";
}

function NewBadge() {
  return (
    <span className="shrink-0 rounded-full border border-neon-green/40 bg-neon-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neon-green">
      New
    </span>
  );
}

function ChangedBadge({ detail }: { detail?: string }) {
  return (
    <span className="shrink-0 rounded-full border border-neon-amber/40 bg-neon-amber/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neon-amber">
      {detail ? `Changed · ${detail}` : "Changed"}
    </span>
  );
}

function RemovedBadge() {
  return (
    <span className="shrink-0 rounded-full border border-line bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-dim">
      Gone
    </span>
  );
}

/** Honest empty-state card — never blank, never jargon. */
function EmptyReason({ field, hasNow, hadBefore }: { field: ReviewField; hasNow: boolean; hadBefore: boolean }) {
  const kind = emptyKind(field, hasNow, hadBefore);
  if (!kind) return null;
  return (
    <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
      <p className="text-sm font-medium text-star">
        {kind === "not-collected" ? "Not collected yet" : kind === "failed-this-pull" ? "Nothing this time" : "No new data"}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-stardust">{emptyReasonCopy(field, kind)}</p>
    </div>
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
      <div className="h-full rounded-full bg-neon-amber/80" style={{ width: `${width}%` }} />
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
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
  );
}

/** Collapsible category card — collapsed by default, Grades excepted. */
function CategoryCard({
  title,
  meta,
  diffSummary,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  diffSummary?: string | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section aria-label={title} className="overflow-hidden rounded-2xl border border-line bg-panel-2/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-star">{title}</span>
          {meta && <span className="mt-0.5 block truncate text-xs text-dim">{meta}</span>}
        </span>
        {diffSummary && (
          <span className="shrink-0 rounded-full border border-neon-teal/40 bg-neon-teal/10 px-2.5 py-1 text-[11px] font-semibold text-neon-teal">
            {diffSummary}
          </span>
        )}
        <Chevron open={open} />
      </button>
      {open && <div className="border-t border-line px-4 py-4">{children}</div>}
    </section>
  );
}

function fmtNum(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

function fmtGradePair(grade: number | null, letter: string | null): React.ReactNode {
  return (
    <span className={gradeTone(grade)}>
      <span className="text-sm font-semibold">{grade !== null ? grade.toFixed(1) : "—"}</span>
      {letter && (
        <>
          <span className="mx-1.5 text-dim" aria-hidden="true">|</span>
          <span className="text-xs font-normal text-dim">{letter}</span>
        </>
      )}
    </span>
  );
}

function formatPulledAt(iso: string | null): string {
  if (!iso) return "unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " at " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

function methodLabel(pullMethod: string | null): string | null {
  if (!pullMethod) return null;
  const m = pullMethod.toLowerCase();
  if (m === "api") return "mobile API";
  if (m === "browser") return "browser automation";
  return pullMethod;
}

function diffSummaryLine(parts: { new: number; changed: number; removed: number }): string | null {
  const bits: string[] = [];
  if (parts.new > 0) bits.push(`${parts.new} new`);
  if (parts.changed > 0) bits.push(`${parts.changed} changed`);
  if (parts.removed > 0) bits.push(`${parts.removed} gone`);
  return bits.length > 0 ? bits.join(" · ") : null;
}

/* ------------------------------------------------------------------ */
/* Types for the review API                                            */
/* ------------------------------------------------------------------ */

interface ReviewHeader {
  pipeline: string;
  pull_method: string | null;
  device_name: string | null;
  synced_at: string | null;
  hours_since_sync: number | null;
  stale: boolean;
  previous_synced_at: string | null;
  previous_hours_since_sync: number | null;
  previous_pipeline: string | null;
}

interface ReviewResponse {
  member: { id: string; name: string | null };
  header: ReviewHeader | null;
  current: SyncSnapshot | null;
  previous: SyncSnapshot | null;
  message?: string;
}

/* ------------------------------------------------------------------ */
/* Sync Data Review — the pilot's window into whether data is flowing  */
/* ------------------------------------------------------------------ */

export function SyncDataReview({ memberId }: { memberId?: string }) {
  const { members, loading: rosterLoading, viewerIsFamilyMember } = useCrewRoster();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(() => {
    if (memberId) return members.find((m) => m.id === memberId) ?? members[0];
    return members.find((m) => m.id === pickedId) ?? members[0];
  }, [members, memberId, pickedId]);

  useEffect(() => {
    if (!memberId && selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPickedId(selected.id);
    }
  }, [memberId, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/crew/members/${selected!.id}/syncs/review`);
        const json = (await res.json()) as ReviewResponse;
        if (cancelled) return;
        if (res.ok) setData(json);
        else setError("Couldn't load the sync review right now.");
      } catch {
        if (!cancelled) setError("Couldn't load the sync review right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = data?.header ?? null;
  const current = data?.current ?? null;
  const previous = data?.previous ?? null;

  const gradeChanges = useMemo(
    () => (current && previous ? diffGrades(current.grades, previous.grades) : []),
    [current, previous],
  );
  const gradeChangeByName = useMemo(() => {
    const map = new Map<string, (typeof gradeChanges)[number]>();
    for (const c of gradeChanges) map.set(c.name.trim().toLowerCase(), c);
    return map;
  }, [gradeChanges]);

  const gpaChanges = useMemo(
    () => (current && previous ? diffKeyed(current.gpa, previous.gpa) : []),
    [current, previous],
  );
  const attendanceChanges = useMemo(
    () => (current && previous ? diffKeyed(current.attendance, previous.attendance) : []),
    [current, previous],
  );
  const categoryChanges = useMemo(
    () => (current && previous ? diffCategories(current.categories, previous.categories) : []),
    [current, previous],
  );
  const dueNextChanges = useMemo(
    () =>
      current && previous
        ? diffTitled(
            current.dueNext.map((d) => ({ title: d.assignment })),
            previous.dueNext.map((d) => ({ title: d.assignment })),
          )
        : [],
    [current, previous],
  );
  const announcementChanges = useMemo(
    () => (current && previous ? diffTitled(current.announcements, previous.announcements) : []),
    [current, previous],
  );
  const calendarChanges = useMemo(
    () => (current && previous ? diffTitled(current.ctlsUpcoming, previous.ctlsUpcoming) : []),
    [current, previous],
  );
  const mailChanges = useMemo(
    () =>
      current && previous
        ? diffTitled(
            [...current.synergyMail, ...current.outlookMail].map((m) => ({ title: m.subject ?? m.preview ?? "" })),
            [...previous.synergyMail, ...previous.outlookMail].map((m) => ({ title: m.subject ?? m.preview ?? "" })),
          )
        : [],
    [current, previous],
  );

  if (rosterLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Kicker>Sync data review</Kicker>
        <p className="text-sm text-stardust">Reading the latest sync…</p>
      </div>
    );
  }

  if (members.length === 0) {
    // Family members (children) never see "Add a child" — steward-only.
    if (viewerIsFamilyMember) {
      return (
        <div className="space-y-4">
          <Kicker>Sync data review</Kicker>
          <h2 className="text-xl font-semibold text-star">No school life here yet</h2>
          <p className="text-sm leading-relaxed text-stardust">
            Your school data shows up here once your parent links your
            profile — ask them for a link code from their Crew section.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <Kicker>Sync data review</Kicker>
        <h2 className="text-xl font-semibold text-star">No school life here yet</h2>
        <p className="text-sm leading-relaxed text-stardust">
          Link a child to see what the school sync collects — grades, assignments,
          and everything else, pull by pull.
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

  const hours = current ? hoursSince(current.syncedAt) : null;

  return (
    <div className="space-y-6">
      {/* Header — pull metadata + freshness */}
      <div>
        <Kicker>Sync data review</Kicker>
        <h2 className="mt-1 text-xl font-semibold text-star">
          {selected?.name ? `What the sync collected for ${selected.name}` : "What the sync collected"}
        </h2>
      </div>

      {members.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Pick a child">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setPickedId(m.id)}
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

      {loading && <p className="text-sm text-stardust">Reading the latest sync…</p>}

      {error && (
        <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
          <p className="text-sm text-stardust">{error}</p>
        </div>
      )}

      {!loading && !error && (!header || !current) && (
        <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
          <p className="text-sm text-stardust">
            {data?.message ?? "No school data yet — connect a school login or tap SYNC NOW."}
          </p>
        </div>
      )}

      {header && current && (
        <>
          {/* Pull metadata */}
          <section aria-label="Latest pull" className="rounded-2xl border border-line bg-panel-2/60 px-4 py-4">
            <SectionTitle>Latest pull</SectionTitle>
            <dl className="space-y-1.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-xs text-dim">Pipeline</dt>
                <dd className="min-w-0 truncate text-right font-medium text-star">{header.pipeline}</dd>
              </div>
              {header.device_name && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-xs text-dim">Device</dt>
                  <dd className="min-w-0 truncate text-right text-stardust">{header.device_name}</dd>
                </div>
              )}
              {methodLabel(header.pull_method) && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-xs text-dim">How it pulled</dt>
                  <dd className="min-w-0 truncate text-right text-stardust">{methodLabel(header.pull_method)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-xs text-dim">Pulled at</dt>
                <dd className="min-w-0 truncate text-right text-stardust">{formatPulledAt(header.synced_at)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-xs text-dim">Freshness</dt>
                <dd className={`min-w-0 truncate text-right font-medium ${header.stale ? "text-neon-amber" : "text-neon-green"}`}>
                  {freshnessLine(hours)}
                </dd>
              </div>
            </dl>
            {header.stale && (
              <p className="mt-3 rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-3.5 py-2.5 text-xs leading-relaxed text-neon-amber">
                This pull is stale — the last school sync was more than a day ago.
                The numbers below may not reflect what&apos;s in the portal right now.
              </p>
            )}
            <p className="mt-3 text-xs leading-relaxed text-dim">
              {previous
                ? `Previous pull: ${formatPulledAt(previous.syncedAt)} · ${header.previous_pipeline ?? "unknown source"} — new and changed items below are highlighted against it.`
                : "This is the first pull on record — there's nothing earlier to compare against, so no change highlights this time."}
            </p>
            {current.zeroGuardFlags.length > 0 ? (
              <div className="mt-3 rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-3.5 py-2.5">
                <p className="text-xs font-semibold text-neon-amber">
                  The sync flagged {current.zeroGuardFlags.length} {current.zeroGuardFlags.length === 1 ? "thing" : "things"} to double-check
                </p>
                <ul className="mt-1.5 space-y-1">
                  {current.zeroGuardFlags.map((f, i) => (
                    <li key={i} className="text-xs leading-relaxed text-stardust">{f}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-3 text-xs text-dim">Data check: all clear — nothing in this pull looked wrong.</p>
            )}
          </section>

          {/* 1 · Class grades */}
          <CategoryCard
            title="Class grades"
            meta={`${current.grades.length} ${current.grades.length === 1 ? "class" : "classes"} in this pull`}
            diffSummary={previous ? diffSummaryLine(countByKind(gradeChanges)) : null}
            defaultOpen
          >
            {current.grades.length === 0 ? (
              <EmptyReason field="grades" hasNow={false} hadBefore={(previous?.grades.length ?? 0) > 0} />
            ) : (
              <ol className="space-y-2">
                {current.grades.map((g) => {
                  const change = gradeChangeByName.get(g.name.trim().toLowerCase());
                  return (
                    <li key={g.name} className="rounded-xl border border-line/70 bg-panel px-3.5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-star">{g.name}</p>
                        <div className="flex shrink-0 items-center gap-2">
                          {change?.kind === "new" && <NewBadge />}
                          {change?.kind === "changed" && (
                            <ChangedBadge detail={`${fmtNum(change.from)} → ${fmtNum(change.to)}`} />
                          )}
                          {change?.kind === "removed" && <RemovedBadge />}
                          {fmtGradePair(g.grade, g.letter)}
                        </div>
                      </div>
                      {g.teacher && <p className="mt-1 truncate text-xs text-dim">{g.teacher}</p>}
                      {g.gapTo90 !== null && g.gapTo90 > 0 ? (
                        <div className="mt-2.5 space-y-1">
                          <GapBar gap={g.gapTo90} />
                          <p className="text-xs text-neon-amber">{g.gapTo90.toFixed(1)} points to the 90 goal</p>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-neon-green">At the goal</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </CategoryCard>

          {/* 2 · Grading breakdowns */}
          <CategoryCard
            title="Grading breakdowns"
            meta="Category weights and averages inside each class"
            diffSummary={previous ? diffSummaryLine({ new: 0, changed: categoryChanges.length, removed: 0 }) : null}
          >
            {current.categories.length === 0 ? (
              <EmptyReason field="categories" hasNow={false} hadBefore={(previous?.categories.length ?? 0) > 0} />
            ) : (
              <div className="space-y-4">
                {current.categories.map((c) => (
                  <div key={c.className}>
                    <p className="mb-1.5 text-sm font-semibold text-star">{c.className}</p>
                    <ol className="space-y-1.5">
                      {c.categories.map((cat) => {
                        const ch = categoryChanges.find(
                          (x) => x.className === c.className && x.category === cat.name,
                        );
                        return (
                          <li
                            key={cat.name}
                            className="flex items-center justify-between gap-2 rounded-xl border border-line/70 bg-panel px-3.5 py-2.5"
                          >
                            <span className="min-w-0 flex-1 truncate text-xs text-stardust">{cat.name}</span>
                            <span className="flex shrink-0 items-center gap-2 text-xs text-dim">
                              {ch && <ChangedBadge />}
                              <span>
                                {cat.weight !== null ? `${cat.weight}% weight` : "weight —"}
                                {" · "}
                                {cat.average !== null ? `${cat.average.toFixed(1)} avg` : "avg —"}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))}
              </div>
            )}
          </CategoryCard>

          {/* 3 · GPA */}
          <CategoryCard
            title="Grade point average"
            meta="Whatever GPA figures the pull carried"
            diffSummary={previous ? diffSummaryLine(countByKind(gpaChanges)) : null}
          >
            {Object.keys(current.gpa).length === 0 ? (
              <EmptyReason field="gpa" hasNow={false} hadBefore={previous ? Object.keys(previous.gpa).length > 0 : false} />
            ) : (
              <dl className="space-y-1.5">
                {Object.entries(current.gpa).map(([k, v]) => {
                  const ch = gpaChanges.find((x) => x.key === k);
                  return (
                    <div key={k} className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-panel px-3.5 py-2.5">
                      <dt className="min-w-0 flex-1 truncate text-sm text-stardust">{prettyKey(k)}</dt>
                      <dd className="flex shrink-0 items-center gap-2 text-sm font-semibold text-star">
                        {ch?.kind === "new" && <NewBadge />}
                        {ch?.kind === "changed" && <ChangedBadge detail={`${ch.from} → ${ch.to}`} />}
                        {ch?.kind === "removed" && <RemovedBadge />}
                        {v}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
            {current.pastPeriods.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-dim">Past grading periods</p>
                <ol className="space-y-1.5">
                  {current.pastPeriods.map((p, i) => (
                    <li key={`${p.period}-${i}`} className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-panel px-3.5 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm text-stardust">{p.period}</span>
                      <span className="shrink-0 text-sm font-semibold text-star">{p.value ?? "—"}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {current.pastPeriods.length === 0 && Object.keys(current.gpa).length > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-dim">
                {emptyReasonCopy("past_periods", "no-new-data")}
              </p>
            )}
          </CategoryCard>

          {/* 4 · Attendance */}
          <CategoryCard
            title="Attendance"
            meta="Absences, tardies, and unexcused time"
            diffSummary={previous ? diffSummaryLine(countByKind(attendanceChanges)) : null}
          >
            {Object.keys(current.attendance).length === 0 ? (
              <EmptyReason field="attendance" hasNow={false} hadBefore={previous ? Object.keys(previous.attendance).length > 0 : false} />
            ) : (
              <dl className="space-y-1.5">
                {Object.entries(current.attendance).map(([k, v]) => {
                  const ch = attendanceChanges.find((x) => x.key === k);
                  return (
                    <div key={k} className="flex items-center justify-between gap-3 rounded-xl border border-line/70 bg-panel px-3.5 py-2.5">
                      <dt className="min-w-0 flex-1 truncate text-sm text-stardust">{prettyKey(k)}</dt>
                      <dd className="flex shrink-0 items-center gap-2 text-sm font-semibold text-star">
                        {ch?.kind === "new" && <NewBadge />}
                        {ch?.kind === "changed" && <ChangedBadge detail={`${ch.from} → ${ch.to}`} />}
                        {ch?.kind === "removed" && <RemovedBadge />}
                        {v}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </CategoryCard>

          {/* 5 · Assignments */}
          <CategoryCard
            title="Assignments"
            meta="Missing, coming up, and recently graded"
            diffSummary={
              previous
                ? missingDiffSummary(current.missing.length, previous.missing.length) ??
                  diffSummaryLine({
                    new: dueNextChanges.filter((d) => d.kind === "new").length,
                    changed: 0,
                    removed: dueNextChanges.filter((d) => d.kind === "removed").length,
                  })
                : null
            }
          >
            <AssignmentGroups current={current} previous={previous} dueNextChanges={dueNextChanges} />
          </CategoryCard>

          {/* 6 · School announcements */}
          <CategoryCard
            title="School announcements"
            meta="What the school feed surfaced"
            diffSummary={previous ? diffSummaryLine(countByKind(announcementChanges)) : null}
          >
            {current.announcements.length === 0 ? (
              <EmptyReason
                field="announcements"
                hasNow={false}
                hadBefore={(previous?.announcements.length ?? 0) > 0}
              />
            ) : (
              <ol className="space-y-2">
                {current.announcements.map((a, i) => (
                  <li key={`${a.title}-${i}`} className="rounded-xl border border-line/70 bg-panel px-3.5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-star">{a.title}</p>
                      {announcementChanges.some((c) => c.kind === "new" && c.title === a.title) && <NewBadge />}
                    </div>
                    <p className="mt-1 text-xs text-dim">
                      {[a.className, a.date].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-dim">Course syllabi</p>
              {current.syllabi.length === 0 ? (
                <p className="text-xs leading-relaxed text-dim">{emptyReasonCopy("syllabi", "not-collected")}</p>
              ) : (
                <ol className="space-y-1.5">
                  {current.syllabi.map((s, i) => (
                    <li key={`${s.className}-${i}`} className="rounded-xl border border-line/70 bg-panel px-3.5 py-2.5">
                      <p className="truncate text-sm text-stardust">{s.className}</p>
                      {s.url && <p className="mt-0.5 truncate text-xs text-neon-teal">{s.url}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </CategoryCard>

          {/* 7 · School email */}
          <CategoryCard
            title="School email"
            meta="Portal messages and school email"
            diffSummary={previous ? diffSummaryLine(countByKind(mailChanges)) : null}
          >
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-dim">School portal messages</p>
                {current.synergyMail.length === 0 ? (
                  <EmptyReason field="synergy" hasNow={false} hadBefore={(previous?.synergyMail.length ?? 0) > 0} />
                ) : (
                  <MailList items={current.synergyMail} changes={mailChanges} />
                )}
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-dim">School email (Outlook)</p>
                {current.outlookMail.length === 0 ? (
                  <EmptyReason field="outlook" hasNow={false} hadBefore={(previous?.outlookMail.length ?? 0) > 0} />
                ) : (
                  <MailList items={current.outlookMail} changes={mailChanges} />
                )}
              </div>
            </div>
          </CategoryCard>

          {/* 8 · School calendar dates */}
          <CategoryCard
            title="School calendar dates"
            meta="Dated events the school feed picked up"
            diffSummary={previous ? diffSummaryLine(countByKind(calendarChanges)) : null}
          >
            {current.ctlsUpcoming.length === 0 ? (
              <EmptyReason field="calendar" hasNow={false} hadBefore={(previous?.ctlsUpcoming.length ?? 0) > 0} />
            ) : (
              <ol className="space-y-2">
                {current.ctlsUpcoming.map((a, i) => (
                  <li key={`${a.title}-${i}`} className="flex items-center justify-between gap-2 rounded-xl border border-line/70 bg-panel px-3.5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-star">{a.title}</span>
                      {a.className && <span className="mt-0.5 block truncate text-xs text-dim">{a.className}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {calendarChanges.some((c) => c.kind === "new" && c.title === a.title) && <NewBadge />}
                      <span className="text-xs font-medium text-neon-green">{a.date ?? "no date"}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CategoryCard>

          <button
            type="button"
            onClick={() => selected && openApplet("school", {}, { replace: true })}
            className="w-full rounded-2xl border border-neon-green/40 bg-neon-green/10 px-5 py-3 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Back to the school station
          </button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assignments card internals                                          */
/* ------------------------------------------------------------------ */

function countByKind(changes: { kind: string }[]): { new: number; changed: number; removed: number } {
  return {
    new: changes.filter((c) => c.kind === "new").length,
    changed: changes.filter((c) => c.kind === "changed").length,
    removed: changes.filter((c) => c.kind === "removed").length,
  };
}

function missingDiffSummary(curCount: number, prevCount: number): string | null {
  if (curCount === prevCount) return null;
  const fewer = curCount < prevCount;
  return fewer
    ? `${prevCount - curCount} fewer missing`
    : `${curCount - prevCount} more missing`;
}

function AssignmentRow({ item, badge }: { item: AssignmentItem; badge?: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-line/70 bg-panel px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-star">{item.title}</p>
        <span className="flex shrink-0 items-center gap-2">
          {badge}
          {item.score && <span className="text-xs font-semibold text-stardust">{item.score}</span>}
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs text-dim">
        {[item.className, item.due, item.category].filter(Boolean).join(" · ") || "—"}
      </p>
    </li>
  );
}

function AssignmentGroups({
  current,
  previous,
  dueNextChanges,
}: {
  current: SyncSnapshot;
  previous: SyncSnapshot | null;
  dueNextChanges: { title: string; kind: "new" | "removed" }[];
}) {
  const isNewTitle = (title: string) =>
    dueNextChanges.some((c) => c.kind === "new" && c.title.trim().toLowerCase() === title.trim().toLowerCase());

  const anyDetail =
    current.missing.length > 0 ||
    current.upcomingAssignments.length > 0 ||
    current.graded.length > 0 ||
    current.dueNext.length > 0 ||
    (current.missingCountFallback ?? 0) > 0;

  return (
    <div className="space-y-5">
      {/* Missing */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-dim">
          Missing{current.missing.length > 0 ? ` · ${current.missing.length}` : ""}
        </p>
        {current.missing.length === 0 && (current.missingCountFallback ?? 0) > 0 && (
          <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5">
            <p className="text-sm text-stardust">
              {current.missingCountFallback} marked missing by the sync — the pull didn&apos;t include the per-assignment detail this time.
            </p>
          </div>
        )}
        {current.missing.length > 0 && (
          <>
            {previous && current.missing.length !== previous.missing.length && (
              <p className="mb-1.5 text-xs text-neon-amber">
                {missingDiffSummary(current.missing.length, previous.missing.length)} since the last pull
                {current.missing.length < previous.missing.length ? " — good progress" : ""}
              </p>
            )}
            <ol className="space-y-1.5">
              {current.missing.map((a, i) => (
                <AssignmentRow key={`${a.title}-${a.className}-${i}`} item={a} />
              ))}
            </ol>
          </>
        )}
        {current.missing.length === 0 && (current.missingCountFallback ?? 0) === 0 && (
          <p className="text-xs leading-relaxed text-dim">Nothing marked missing in this pull.</p>
        )}
      </div>

      {/* Coming up (due_next) */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-dim">
          Coming up{current.dueNext.length > 0 ? ` · ${current.dueNext.length}` : ""}
        </p>
        {current.dueNext.length === 0 ? (
          <p className="text-xs leading-relaxed text-dim">No dated upcoming work in this pull.</p>
        ) : (
          <ol className="space-y-1.5">
            {current.dueNext.map((d, i) => (
              <li key={`${d.assignment}-${i}`} className="flex items-center justify-between gap-2 rounded-xl border border-line/70 bg-panel px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-star">{d.assignment}</span>
                  {d.className && <span className="mt-0.5 block truncate text-xs text-dim">{d.className}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {isNewTitle(d.assignment) && <NewBadge />}
                  <span className="text-xs font-medium text-neon-green">{d.due ?? "no date"}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Recently graded */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-dim">
          Recently graded{current.graded.length > 0 ? ` · ${current.graded.length}` : ""}
        </p>
        {current.graded.length === 0 ? (
          <p className="text-xs leading-relaxed text-dim">No graded work in this pull.</p>
        ) : (
          <ol className="space-y-1.5">
            {current.graded.slice(0, 12).map((a, i) => (
              <AssignmentRow key={`${a.title}-${a.className}-${i}`} item={a} />
            ))}
          </ol>
        )}
      </div>

      {!anyDetail && (
        <EmptyReason
          field="assignments"
          hasNow={false}
          hadBefore={
            !!previous &&
            (previous.missing.length > 0 ||
              previous.upcomingAssignments.length > 0 ||
              previous.graded.length > 0 ||
              previous.dueNext.length > 0)
          }
        />
      )}
    </div>
  );
}

function MailList({
  items,
  changes,
}: {
  items: SyncSnapshot["synergyMail"];
  changes: { title: string; kind: "new" | "removed" }[];
}) {
  return (
    <ol className="space-y-2">
      {items.slice(0, 10).map((m, i) => {
        const title = m.subject ?? m.preview ?? "";
        const isNew = changes.some(
          (c) => c.kind === "new" && c.title.trim().toLowerCase() === title.trim().toLowerCase() && title !== "",
        );
        return (
          <li key={`${m.source}-${m.date ?? ""}-${i}`} className="rounded-xl border border-line/70 bg-panel px-3.5 py-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-star">
                {m.sender ?? "School portal"}
              </p>
              <span className="flex shrink-0 items-center gap-2">
                {isNew && <NewBadge />}
                {m.date && <span className="text-xs text-dim">{m.date}</span>}
              </span>
            </div>
            {m.subject && <p className="mt-0.5 truncate text-xs text-stardust">{m.subject}</p>}
            {m.preview && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-dim">{m.preview}</p>}
          </li>
        );
      })}
    </ol>
  );
}
