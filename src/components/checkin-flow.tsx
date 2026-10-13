"use client";

import { useState } from "react";
import { checkYouthSafety } from "@/lib/youth-safety";

const WORKED_ON_CHIPS = [
  "Homework",
  "Quiz prep",
  "Notes review",
  "Practice problems",
  "Studied with friend",
  "Watched videos",
];
const CONFUSING_CHIPS = [
  "Nothing — got it",
  "Didn't understand lecture",
  "Homework problems",
  "Need to review notes",
  "Test format unclear",
];
const DUE_NEXT_CHIPS = [
  "Quiz",
  "Test",
  "Homework",
  "Project",
  "Lab report",
  "Nothing due",
];

export interface SavedCheckin {
  id: string;
  class_name: string | null;
  checkin_date: string;
  worked_on: string[];
  confusing: string[];
  due_next: string[];
  note: string | null;
  channel: "shared" | "private";
  created_by: string;
  created_at: string;
}

function Chip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
        selected
          ? "border-neon-green/60 bg-neon-green/15 text-neon-green"
          : "border-line bg-panel-2/60 text-stardust hover:border-neon-green/30 hover:text-star"
      }`}
    >
      {label}
    </button>
  );
}

function Question({
  title,
  chips,
  selected,
  onToggle,
}: {
  title: string;
  chips: string[];
  selected: string[];
  onToggle: (chip: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-star">{title}</legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <Chip
            key={chip}
            label={chip}
            selected={selected.includes(chip)}
            onToggle={() => onToggle(chip)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function toggleIn(list: string[], chip: string): string[] {
  return list.includes(chip) ? list.filter((c) => c !== chip) : [...list, chip];
}

/**
 * CheckinFlow — the 30-second daily check-in.
 *
 * Three questions with quick-tap chips + optional free text (NO energy
 * slider — Meheldi killed it). Two channels: shared (parent-visible, the
 * DEFAULT per D1) and "Just for me" private. Saved to Supabase (never
 * localStorage); the parent calls back `onSaved` to wire the words into
 * guidance ("You flagged this").
 */
export function CheckinFlow({
  memberId,
  className,
  onSaved,
}: {
  memberId: string;
  /** null for a general daily check-in, class name for a per-class one. */
  className: string | null;
  onSaved?: (checkin: SavedCheckin) => void;
}) {
  const [workedOn, setWorkedOn] = useState<string[]>([]);
  const [confusing, setConfusing] = useState<string[]>([]);
  const [dueNext, setDueNext] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<"shared" | "private">("shared");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [safety, setSafety] = useState<string | null>(null);

  const hasAnything =
    workedOn.length > 0 ||
    confusing.length > 0 ||
    dueNext.length > 0 ||
    note.trim().length > 0;

  async function save() {
    if (saving || !hasAnything) return;
    setSaving(true);
    setError("");

    // D2 safety floor: duty-of-care, not a filter. Check the free text
    // before saving; show 988 + trusted-adult guidance when it matches.
    const hit = checkYouthSafety(note);
    if (hit) setSafety(hit.guidance);

    try {
      const res = await fetch(`/api/crew/members/${memberId}/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_name: className,
          worked_on: workedOn,
          confusing,
          due_next: dueNext,
          note: note.trim() || undefined,
          channel,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Couldn't save that check-in.");
      }
      setDone(true);
      setWorkedOn([]);
      setConfusing([]);
      setDueNext([]);
      setNote("");
      onSaved?.(json.checkin as SavedCheckin);
      window.setTimeout(() => setDone(false), 4000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't save that check-in. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel-2/60 px-4 py-4">
      {done && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="confetti-bit"
              style={{
                left: `${(i * 41) % 100}%`,
                background: ["#a3e635", "#22d3ee", "#f472b6", "#fbbf24"][i % 4],
                animationDelay: `${(i % 8) * 0.06}s`,
              }}
            />
          ))}
          <style>{`.confetti-bit{position:absolute;top:-8px;width:7px;height:10px;border-radius:2px;animation:confetti-fall 1.6s ease-in forwards}@keyframes confetti-fall{to{transform:translateY(220px) rotate(540deg);opacity:0}}@media (prefers-reduced-motion: reduce){.confetti-bit{display:none}}`}</style>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-star">
          {done ? "Checked in — nice work." : className ? `Check in — ${className}` : "Daily check-in"}
        </p>
        {done && (
          <span className="rounded-full border border-neon-green/50 bg-neon-green/10 px-2.5 py-0.5 text-xs font-medium text-neon-green">
            Saved
          </span>
        )}
      </div>
      {!done && (
        <p className="mt-0.5 text-xs text-dim">
          30 seconds. Tap what fits — words are optional.
        </p>
      )}

      <div className="mt-3 space-y-4">
        <Question
          title="What did you work on today?"
          chips={WORKED_ON_CHIPS}
          selected={workedOn}
          onToggle={(c) => setWorkedOn((p) => toggleIn(p, c))}
        />
        <Question
          title="What's confusing?"
          chips={CONFUSING_CHIPS}
          selected={confusing}
          onToggle={(c) => setConfusing((p) => toggleIn(p, c))}
        />
        <Question
          title="What's due next?"
          chips={DUE_NEXT_CHIPS}
          selected={dueNext}
          onToggle={(c) => setDueNext((p) => toggleIn(p, c))}
        />

        <div>
          <label
            htmlFor={`checkin-note-${memberId}`}
            className="text-sm font-medium text-star"
          >
            Anything else? <span className="font-normal text-dim">(optional)</span>
          </label>
          <textarea
            id={`checkin-note-${memberId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="A line about today, in your own words…"
            className="mt-1.5 w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-star placeholder:text-dim/70 focus:border-neon-green/50 focus:outline-none"
          />
        </div>

        {/* Two channels: shared (default, D1) + "Just for me" private */}
        <div
          role="radiogroup"
          aria-label="Who can see this check-in"
          className="flex gap-2"
        >
          {(
            [
              {
                id: "shared",
                label: "Shared",
                hint: "Your parent can see this",
              },
              {
                id: "private",
                label: "Just for me",
                hint: "Only you — never shown to your parent",
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={channel === opt.id}
              onClick={() => setChannel(opt.id)}
              className={`flex-1 rounded-xl border px-3 py-2 text-left transition-colors ${
                channel === opt.id
                  ? "border-neon-green/50 bg-neon-green/10"
                  : "border-line bg-panel-2/40 hover:border-dim/60"
              }`}
            >
              <span className="block text-xs font-semibold text-star">
                {opt.id === "private" ? "🔒 " : ""}
                {opt.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-dim">
                {opt.hint}
              </span>
            </button>
          ))}
        </div>

        {safety && (
          <div
            role="alert"
            className="rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-4 py-3"
          >
            <p className="text-sm font-semibold text-neon-amber">
              We hear you — and this matters more than homework.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-star">{safety}</p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-neon-amber">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving || !hasAnything}
          className="w-full rounded-xl border border-neon-green/50 bg-neon-green/15 px-4 py-2.5 text-sm font-semibold text-neon-green transition-all hover:bg-neon-green/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Check in"}
        </button>
      </div>
    </div>
  );
}
