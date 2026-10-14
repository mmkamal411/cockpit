"use client";

import { useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Shared shapes (match the class-detail API)                           */
/* ------------------------------------------------------------------ */

export interface DetailAssignment {
  title: string;
  due: string | null;
  due_label: string;
  score: number | null;
  percent: number | null;
  category: string | null;
  notes: string;
}

export interface CategoryWeight {
  name: string;
  weight: number;
}

function gradeTone(score: number | null): string {
  if (score === null) return "text-dim";
  if (score >= 90) return "text-neon-green";
  if (score >= 80) return "text-star";
  if (score >= 74) return "text-neon-amber";
  return "text-red-400";
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
      {children}
    </p>
  );
}

/** Honest placeholder — real data or a plain-English state, never a dead button. */
export function HonestSoon({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-2">
      <SectionTitle>{title}</SectionTitle>
      <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-4">
        <p className="text-sm leading-relaxed text-stardust">{body}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Category breakdown — every grade category with weight + average      */
/* ------------------------------------------------------------------ */

interface CatStat {
  name: string;
  weight: number;
  avg: number | null;
  count: number;
}

function pctOf(a: DetailAssignment): number | null {
  if (a.percent !== null && Number.isFinite(a.percent)) return a.percent;
  return null;
}

export function CategoryBreakdown({
  categories,
  assignments,
}: {
  categories: CategoryWeight[];
  assignments: DetailAssignment[];
}) {
  const stats: CatStat[] = useMemo(() => {
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
    return categories.map((c) => {
      const pcts: number[] = [];
      for (const a of assignments) {
        if (!a.category) continue;
        const n = norm(a.category);
        const k = norm(c.name);
        if (n === k || n.includes(k) || k.includes(n)) {
          const p = pctOf(a);
          if (p !== null) pcts.push(p);
        }
      }
      return {
        name: c.name,
        weight: c.weight,
        avg: pcts.length > 0 ? pcts.reduce((s, p) => s + p, 0) / pcts.length : null,
        count: pcts.length,
      };
    });
  }, [categories, assignments]);

  const maxWeight = Math.max(1, ...stats.map((s) => s.weight));

  return (
    <div className="space-y-2">
      <SectionTitle>Categories · {stats.length}</SectionTitle>
      {stats.length === 0 ? (
        <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-4">
          <p className="text-sm leading-relaxed text-stardust">
            Category weights aren&apos;t in the latest sync yet — they&apos;ll
            appear here once the school login shares them.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {stats.map((s) => {
            const dragging = s.avg !== null && s.avg < 74;
            return (
              <div
                key={s.name}
                className={`rounded-xl border px-4 py-3 ${
                  dragging
                    ? "border-neon-amber/30 bg-neon-amber/5"
                    : "border-line bg-panel-2/60"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-star">
                    {s.name}
                  </p>
                  <p className="shrink-0 text-xs tabular-nums text-dim">
                    {s.weight % 1 === 0 ? s.weight : s.weight.toFixed(1)}% weight
                  </p>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div
                    className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line/60"
                    role="img"
                    aria-label={`${s.name}: ${s.weight}% of the grade`}
                  >
                    <div
                      className={`h-full rounded-full ${dragging ? "bg-neon-amber" : "bg-neon-green/70"}`}
                      style={{ width: `${Math.min(100, (s.weight / maxWeight) * 100)}%` }}
                    />
                  </div>
                  <p className={`shrink-0 text-sm font-semibold tabular-nums ${gradeTone(s.avg)}`}>
                    {s.avg !== null ? `${s.avg.toFixed(1)} avg` : "no scores yet"}
                  </p>
                </div>
                {dragging && (
                  <p className="mt-1.5 text-xs text-neon-amber">
                    Pulling the grade down — points here move the needle fastest.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assignments grouped — Missing Work / Upcoming / Past Assignments     */
/* ------------------------------------------------------------------ */

function parseDueLabel(due: string | null): Date | null {
  if (!due) return null;
  const m = due.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isMissing(a: DetailAssignment, today: Date): boolean {
  if (a.score !== null) return false;
  const d = parseDueLabel(a.due);
  return d !== null && d < today;
}

function isUpcoming(a: DetailAssignment, today: Date): boolean {
  if (a.score !== null) return false;
  const d = parseDueLabel(a.due);
  return d === null || d >= today;
}

function isDueSoon(a: DetailAssignment, today: Date): boolean {
  const d = parseDueLabel(a.due);
  if (!d) return false;
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  return diff >= 0 && diff <= 3;
}

function AssignmentRow({
  a,
  right,
  rightClass,
  tone,
}: {
  a: DetailAssignment;
  right: string;
  rightClass?: string;
  tone?: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${tone ?? "border-line bg-panel-2/60"}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-star" title={a.title}>
          {a.title}
        </p>
        <p className="truncate text-xs text-dim">
          {a.category ? `${a.category} · ` : ""}
          {a.due_label}
          {a.score !== null ? ` · scored ${a.score}` : ""}
        </p>
      </div>
      <span className={`shrink-0 text-xs font-semibold ${rightClass ?? "text-dim"}`}>
        {right}
      </span>
    </div>
  );
}

function GroupHeader({
  open,
  onToggle,
  title,
  count,
  collapsible,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  count: number;
  collapsible: boolean;
}) {
  const inner = (
    <>
      <span>
        {title}{" "}
        <span className="font-normal text-dim tabular-nums">({count})</span>
      </span>
      {collapsible && (
        <span
          aria-hidden="true"
          className={`shrink-0 text-dim transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      )}
    </>
  );
  const cls =
    "flex w-full items-center justify-between gap-2 text-sm font-bold text-star";
  return collapsible ? (
    <button type="button" onClick={onToggle} aria-expanded={open} className={cls}>
      {inner}
    </button>
  ) : (
    <h3 className={cls}>{inner}</h3>
  );
}

export function AssignmentsGrouped({
  assignments,
}: {
  assignments: DetailAssignment[];
}) {
  const [pastOpen, setPastOpen] = useState(false);
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const { missing, upcoming, past } = useMemo(() => {
    const missing = assignments.filter((a) => isMissing(a, today));
    const upcoming = assignments
      .filter((a) => !isMissing(a, today) && isUpcoming(a, today))
      .sort((a, b) => {
        const da = parseDueLabel(a.due);
        const db = parseDueLabel(b.due);
        if (!da) return 1;
        if (!db) return -1;
        return da.getTime() - db.getTime();
      });
    const past = assignments.filter(
      (a) => !isMissing(a, today) && !isUpcoming(a, today),
    );
    return { missing, upcoming, past };
  }, [assignments, today]);

  if (assignments.length === 0) {
    return (
      <div className="space-y-2">
        <SectionTitle>Assignments</SectionTitle>
        <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-4 text-sm text-stardust">
          No assignments tracked yet for this class — they&apos;ll appear with
          the next sync.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <GroupHeader
          open
          onToggle={() => {}}
          title="Missing work"
          count={missing.length}
          collapsible={false}
        />
        {missing.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
            Nothing missing — keeping it that way is the whole game.
          </p>
        ) : (
          <div className="space-y-2">
            {missing.map((a, i) => (
              <AssignmentRow
                key={`m-${i}-${a.title}`}
                a={a}
                right="Missing"
                rightClass="rounded-md border border-neon-amber/40 px-2 py-0.5 text-neon-amber"
                tone="border-neon-amber/25 bg-neon-amber/5"
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <GroupHeader
          open
          onToggle={() => {}}
          title="Upcoming"
          count={upcoming.length}
          collapsible={false}
        />
        {upcoming.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
            Nothing with a future due date right now — clear runway.
          </p>
        ) : (
          <div className="space-y-2">
            {upcoming.map((a, i) => (
              <AssignmentRow
                key={`u-${i}-${a.title}`}
                a={a}
                right={isDueSoon(a, today) ? "Due soon" : a.due_label}
                rightClass={
                  isDueSoon(a, today)
                    ? "rounded-md border border-neon-green/40 px-2 py-0.5 text-neon-green"
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <GroupHeader
          open={pastOpen}
          onToggle={() => setPastOpen((v) => !v)}
          title="Past assignments"
          count={past.length}
          collapsible
        />
        {pastOpen && (
          <div className="space-y-2">
            {past.length === 0 ? (
              <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
                No past assignments in the sync history yet.
              </p>
            ) : (
              past.map((a, i) => {
                const p = pctOf(a);
                return (
                  <AssignmentRow
                    key={`p-${i}-${a.title}`}
                    a={a}
                    right={p !== null ? `${p.toFixed(0)}%` : a.score !== null ? `${a.score}` : "—"}
                    rightClass={`text-sm tabular-nums ${gradeTone(p)}`}
                    tone="border-line bg-panel-2/40"
                  />
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* What-if simulator — pick an assignment, slide the score, watch the  */
/* estimated grade move. Pure client-side, category-weight aware.       */
/* ------------------------------------------------------------------ */

interface CatGroup {
  name: string;
  weight: number;
  pcts: number[];
  titles: string[];
}

function groupByCategory(
  assignments: DetailAssignment[],
  weights: CategoryWeight[],
): CatGroup[] {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  const map = new Map<string, CatGroup>();
  for (const a of assignments) {
    const raw = (a.category ?? "").trim() || "Uncategorized";
    const key =
      weights.find((w) => norm(w.name) === norm(raw))?.name ??
      weights.find(
        (w) => norm(w.name).includes(norm(raw)) || norm(raw).includes(norm(w.name)),
      )?.name ??
      raw;
    const weight = weights.find((w) => w.name === key)?.weight ?? 0;
    // Missing work counts as a zero; ungraded future work doesn't move the average.
    const p = pctOf(a);
    const pct = p ?? (a.score === null ? 0 : null);
    if (pct === null) continue;
    let g = map.get(key);
    if (!g) {
      g = { name: key, weight, pcts: [], titles: [] };
      map.set(key, g);
    }
    g.pcts.push(pct);
    g.titles.push(a.title);
  }
  return [...map.values()];
}

function overallOf(groups: CatGroup[]): number | null {
  const weighted = groups.filter((g) => g.weight > 0);
  if (weighted.length === 0) return null;
  const totalWeight = weighted.reduce((s, g) => s + g.weight, 0);
  if (totalWeight === 0) return null;
  const sum = weighted.reduce((s, g) => {
    const avg = g.pcts.reduce((a, p) => a + p, 0) / g.pcts.length;
    return s + (g.weight / 100) * avg;
  }, 0);
  return (sum / totalWeight) * 100;
}

export function WhatIfSimulator({
  assignments,
  categories,
  currentGrade,
}: {
  assignments: DetailAssignment[];
  categories: CategoryWeight[];
  currentGrade: number | null;
}) {
  const groups = useMemo(
    () => (categories.length > 0 ? groupByCategory(assignments, categories) : []),
    [assignments, categories],
  );
  const baseline = useMemo(() => overallOf(groups), [groups]);

  const candidates = useMemo(() => {
    const all: { key: string; title: string; pct: number; cat: string }[] = [];
    for (const g of groups) {
      g.titles.forEach((t, i) => {
        all.push({ key: `${g.name}::${t}::${i}`, title: t, pct: g.pcts[i], cat: g.name });
      });
    }
    return all.sort((x, y) => x.pct - y.pct).slice(0, 12);
  }, [groups]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [score, setScore] = useState(85);
  const selKey = selectedKey ?? candidates[0]?.key ?? null;

  const simulated = useMemo(() => {
    if (!selKey) return null;
    const next = groups.map((g) => {
      const idx = g.titles.findIndex((t, i) => `${g.name}::${t}::${i}` === selKey);
      if (idx < 0) return g;
      const pcts = [...g.pcts];
      pcts[idx] = score;
      return { ...g, pcts };
    });
    return overallOf(next);
  }, [groups, selKey, score]);

  if (categories.length === 0) {
    return (
      <div className="space-y-2">
        <SectionTitle>What-if simulator</SectionTitle>
        <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-4">
          <p className="text-sm leading-relaxed text-stardust">
            Category weights for this class aren&apos;t captured yet — the
            simulator unlocks once the next sync brings them in.
          </p>
        </div>
      </div>
    );
  }

  const base = baseline ?? currentGrade;
  const sel = candidates.find((c) => c.key === selKey);
  const delta = base !== null && simulated !== null ? simulated - base : null;

  return (
    <div className="space-y-2">
      <SectionTitle>What-if simulator</SectionTitle>
      <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-4">
        <p className="text-xs leading-relaxed text-dim">
          Pick an assignment, slide the score — watch the estimated grade move.
        </p>
        {candidates.length > 0 ? (
          <>
            <label className="mt-3 block">
              <span className="text-xs text-dim">Assignment</span>
              <select
                value={selKey ?? ""}
                onChange={(e) => {
                  setSelectedKey(e.target.value);
                  setScore(85);
                }}
                className="mt-1 w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-star"
              >
                {candidates.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.title.length > 48 ? `${c.title.slice(0, 48)}…` : c.title} —{" "}
                    {c.cat} ({c.pct.toFixed(0)}% now)
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block">
              <span className="mb-1 flex items-center justify-between text-xs text-dim">
                <span>New score</span>
                <span className="font-bold tabular-nums text-neon-green">{score}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                className="w-full accent-emerald-300"
                aria-label="Simulated score"
              />
            </label>
            {base !== null && simulated !== null && (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-panel-2 px-4 py-3">
                <div className="text-center">
                  <p className="text-lg font-bold tabular-nums text-dim">{base.toFixed(1)}</p>
                  <p className="text-[10px] uppercase tracking-wider text-dim">Now</p>
                </div>
                <span className="text-neon-green" aria-hidden="true">→</span>
                <div className="text-center">
                  <p
                    className={`text-lg font-bold tabular-nums ${simulated >= base ? "text-neon-green" : "text-star"}`}
                  >
                    {simulated.toFixed(1)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-dim">What-if</p>
                </div>
                {delta !== null && (
                  <p
                    className={`ml-auto text-sm font-bold tabular-nums ${delta >= 0 ? "text-neon-green" : "text-red-400"}`}
                  >
                    {delta >= 0 ? "+" : ""}{delta.toFixed(1)} pts
                  </p>
                )}
              </div>
            )}
            {sel && (
              <p className="mt-2 text-[11px] leading-relaxed text-dim">
                {sel.cat} is{" "}
                {categories.find((c) => c.name === sel.cat)?.weight ?? "?"}% of the
                grade — {sel.pct < 70 ? "recovering it moves the needle fast." : "every point here counts."}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-xs text-dim">
            No scored assignments to simulate against yet.
          </p>
        )}
        <p className="mt-2 text-[11px] text-dim">
          Estimate only — the real gradebook decides.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Explain it back — 60-second voice self-test (the protégé effect).    */
/* Recording + playback work on this device; saving to class files     */
/* isn't wired up yet, so there's no dead Save button — just honesty.  */
/* ------------------------------------------------------------------ */

const MAX_SECONDS = 60;

export function ExplainBack({ topic }: { topic: string }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [explanation, setExplanation] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopRecording = () => {
    stopTimer();
    try {
      mediaRef.current?.stop();
    } catch {
      // already stopped
    }
    setRecording(false);
  };

  async function startRecording() {
    setMicError(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setMicError(
        "Voice recording needs a secure connection here — you can write your explanation below instead.",
      );
      setTextMode(true);
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setAudioUrl(URL.createObjectURL(blob));
        stream?.getTracks().forEach((t) => t.stop());
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            stopRecording();
            return MAX_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setMicError(
          "Microphone access was blocked — check the mic icon in the address bar, then try again.",
        );
      } else {
        setMicError("Couldn't start the microphone. You can write your explanation below instead.");
        setTextMode(true);
      }
    }
  }

  function discard() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setSeconds(0);
  }

  const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const wordCount =
    explanation.trim() === "" ? 0 : explanation.trim().split(/\s+/).length;

  return (
    <div className="space-y-2">
      <SectionTitle>Explain it back</SectionTitle>
      <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-4">
        <p className="text-xs leading-relaxed text-dim">
          Can you teach <span className="font-semibold text-star">{topic}</span>{" "}
          to someone who missed class? Record 60 seconds — gaps in your
          explanation are gaps in your understanding.
        </p>

        {micError && (
          <p role="alert" className="mt-3 rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-3.5 py-2.5 text-xs text-star">
            {micError}
          </p>
        )}

        {!recording && !audioUrl && !textMode && (
          <button
            type="button"
            onClick={startRecording}
            className="mt-3 w-full rounded-xl border border-neon-green/40 bg-neon-green/10 py-3 text-sm font-bold text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Start 60-second self-test
          </button>
        )}

        {recording && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-panel-2 p-3">
            <div className="flex items-center gap-2">
              <span className="relative flex size-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon-amber opacity-60" />
                <span className="relative inline-flex size-3 rounded-full bg-neon-amber" />
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-star">{mm}</span>
            </div>
            <button
              type="button"
              onClick={stopRecording}
              className="rounded-xl border border-line px-4 py-1.5 text-xs font-bold text-star"
            >
              Stop
            </button>
          </div>
        )}

        {!recording && audioUrl && !textMode && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-panel-2 p-3">
              <audio src={audioUrl} controls className="h-8 w-full" />
              <span className="font-mono text-xs tabular-nums text-dim">{mm}</span>
            </div>
            <button
              type="button"
              onClick={discard}
              className="rounded-xl border border-line px-3.5 py-2 text-xs font-semibold text-dim"
            >
              Discard and try again
            </button>
          </div>
        )}

        {!recording && !textMode && (
          <button
            type="button"
            onClick={() => {
              setTextMode(true);
              setMicError(null);
            }}
            className="mt-2 w-full rounded-xl border border-line py-2.5 text-xs font-semibold text-dim transition-colors hover:text-star"
          >
            Or write your explanation
          </button>
        )}

        {!recording && textMode && (
          <div className="mt-3 space-y-2">
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder={`Explain ${topic} like you're teaching a friend…`}
              aria-label="Write your explanation"
              className="w-full rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 text-sm text-star placeholder:text-dim/70"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-dim">
                {wordCount} words · aim for ~100 words, about 60 seconds of speech
              </span>
              <button
                type="button"
                onClick={() => {
                  setTextMode(false);
                  setExplanation("");
                }}
                className="rounded-xl border border-line px-3.5 py-2 text-xs font-semibold text-dim"
              >
                Back to voice
              </button>
            </div>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-dim">
          Saving explanations to class files is coming soon — for now your
          recording stays on this device.
        </p>
      </div>
    </div>
  );
}
