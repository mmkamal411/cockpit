"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckinFlow } from "@/components/checkin-flow";
import { getMorningSpark } from "@/lib/child/morning-spark";
import type { AgeTier } from "@/lib/child/age-tier";

interface ClassInfo {
  name: string;
  grade: number | null;
  letter: string | null;
  gap_to_90: number | null;
  missing_count: number;
  due_today_count: number;
}

interface Overview {
  member: { id: string; name: string; tier: AgeTier };
  classes: ClassInfo[];
  bell: { period: string; ends_at: string; label: string } | null;
  checked_in_today: boolean;
  one_action: { title: string; class_name: string | null; due_label: string } | null;
  synced_at: string | null;
  has_data: boolean;
}

/** Amber never red — grades are mission framing, never judgment. */
function gradeTone(grade: number | null): string {
  if (grade === null) return "text-dim";
  if (grade >= 90) return "text-neon-green";
  if (grade >= 80) return "text-star";
  return "text-neon-amber";
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function syncAge(syncedAt: string | null): string | null {
  if (!syncedAt) return null;
  const mins = Math.round((Date.now() - new Date(syncedAt).getTime()) / 60000);
  if (mins < 1) return "synced just now";
  if (mins < 60) return `synced ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `synced ${hrs} hr ago`;
  return `synced ${Math.round(hrs / 24)} days ago`;
}

/**
 * The child's Home — pilot-type aware. Delight first (morning spark),
 * then orientation (bell strip), then the one job (check in), then
 * tonight's ONE action. Classes sorted by today's relevance, never led
 * with a grade number.
 */
export function ChildHome() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [showCheckin, setShowCheckin] = useState(false);

  const spark = useMemo(() => getMorningSpark(), []);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/child/overview");
      const json = (await res.json().catch(() => null)) as (Overview & { error?: string }) | null;
      if (!res.ok) throw new Error(json?.error ?? "Couldn't load your school day.");
      setData(json as Overview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your school day. Try again.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) {
    return (
      <section
        aria-label="Your school day"
        className="glass-pane pointer-events-auto w-full max-w-sm rounded-3xl border border-line bg-panel/55 p-5 text-center shadow-[0_20px_70px_rgb(0_0_0/0.5)] backdrop-blur-xl"
      >
        <p aria-hidden="true" className="text-3xl">🛸</p>
        <p className="mt-3 text-sm font-medium text-star">Couldn&apos;t load your school day</p>
        <p className="mt-1 text-xs text-stardust">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-4 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-5 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
        >
          Try again
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section
        aria-label="Your school day"
        className="glass-pane pointer-events-auto w-full max-w-sm rounded-3xl border border-line bg-panel/55 p-5 shadow-[0_20px_70px_rgb(0_0_0/0.5)] backdrop-blur-xl"
      >
        <p className="text-sm text-stardust">Getting your school day ready…</p>
      </section>
    );
  }

  const firstName = data.member.name.trim().split(" ")[0] || data.member.name;
  const freshness = syncAge(data.synced_at);

  return (
    <section
      aria-label="Your school day"
      className="glass-pane pointer-events-auto w-full max-w-sm rounded-3xl border border-line bg-panel/55 p-5 shadow-[0_20px_70px_rgb(0_0_0/0.5)] backdrop-blur-xl"
    >
      {/* 1. Delight first */}
      <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">
        {greeting()}, {firstName}
      </p>
      <div className="mt-2 rounded-2xl border border-line bg-panel-2/50 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-dim">✨ Morning spark</p>
        <p className="mt-1.5 text-sm leading-relaxed text-star">{spark.fact}</p>
        <p className="mt-2 text-xs italic leading-relaxed text-stardust">
          &ldquo;{spark.quote}&rdquo; <span className="not-italic text-dim">— {spark.quoteBy}</span>
        </p>
      </div>

      {/* 2. Orientation */}
      {data.bell && (
        <p className="mt-3 flex items-center gap-2 text-sm text-stardust" aria-live="polite">
          <span aria-hidden="true">🕙</span> {data.bell.label}
        </p>
      )}

      {/* 3. The one job: check in */}
      <div className="mt-4">
        {data.checked_in_today && !showCheckin ? (
          <div className="flex items-center justify-between rounded-2xl border border-neon-green/30 bg-neon-green/5 px-4 py-3">
            <p className="text-sm font-medium text-star">✓ Checked in — nice work</p>
            <button
              type="button"
              onClick={() => setShowCheckin(true)}
              className="text-xs text-dim underline decoration-dotted underline-offset-2 hover:text-stardust"
            >
              Check in again
            </button>
          </div>
        ) : showCheckin ? (
          <div>
            <CheckinFlow
              memberId={data.member.id}
              className={null}
              onSaved={() => {
                setShowCheckin(false);
                load();
              }}
            />
            <button
              type="button"
              onClick={() => setShowCheckin(false)}
              className="mt-2 text-xs text-dim underline decoration-dotted underline-offset-2 hover:text-stardust"
            >
              Not right now
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCheckin(true)}
            className="w-full rounded-2xl border border-neon-green/40 bg-neon-green/10 px-4 py-4 text-left transition-colors hover:bg-neon-green/20"
          >
            <p className="text-base font-semibold text-star">✅ Check in — how&apos;s today going?</p>
            <p className="mt-0.5 text-xs text-stardust">Takes 30 seconds. Your words help Crystal help you.</p>
          </button>
        )}
      </div>

      {/* 4. Tonight's ONE action */}
      {data.one_action && (
        <div className="mt-4 rounded-2xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-neon-amber">
            🎯 Tonight&apos;s one thing
          </p>
          <p className="mt-1 text-sm font-medium text-star">{data.one_action.title}</p>
          <p className="mt-0.5 text-xs text-stardust">
            {data.one_action.class_name && `${data.one_action.class_name} · `}
            {data.one_action.due_label}
          </p>
        </div>
      )}

      {/* 5. Classes, by today's relevance */}
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-dim">
          Classes
        </p>
        {!data.has_data ? (
          <div className="rounded-2xl border border-line bg-panel-2/50 px-4 py-3">
            <p className="text-sm text-stardust">No school data yet</p>
            <p className="mt-1 text-xs leading-relaxed text-dim">
              Once your school login is connected and synced, your classes show up here — sorted by what matters today.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {data.classes.map((c) => (
              <li
                key={c.name}
                className="flex items-center justify-between gap-2 rounded-xl border border-line bg-panel-2/50 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-star">{c.name}</p>
                  {(c.due_today_count > 0 || c.missing_count > 0) && (
                    <p className="mt-0.5 text-[11px] text-neon-amber">
                      {c.due_today_count > 0 && `${c.due_today_count} due today`}
                      {c.due_today_count > 0 && c.missing_count > 0 && " · "}
                      {c.missing_count > 0 && `${c.missing_count} missing`}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-baseline gap-1.5">
                  {c.gap_to_90 !== null && c.gap_to_90 > 0 && (
                    <span className="text-[11px] text-dim">{c.gap_to_90.toFixed(1)} to 90</span>
                  )}
                  <span className={`text-sm font-semibold ${gradeTone(c.grade)}`}>
                    {c.grade !== null ? c.grade.toFixed(1) : "—"}
                    {c.letter && <span className="ml-1 text-xs font-normal text-dim">{c.letter}</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer: freshness + sharing */}
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <p className="text-[11px] text-dim">
          {freshness ?? "Not synced yet"}
        </p>
        <a
          href="/sharing"
          className="text-[11px] text-dim underline decoration-dotted underline-offset-2 transition-colors hover:text-stardust"
        >
          My sharing →
        </a>
      </div>
    </section>
  );
}
