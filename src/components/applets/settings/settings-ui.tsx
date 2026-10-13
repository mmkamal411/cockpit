"use client";

import type { ReactNode } from "react";

/**
 * Shared instrument-panel primitives for the settings panels.
 * Dark cockpit theme: black panels, subtle neon accents, calm content.
 * Every setting carries a plain-English "what this does" line.
 */

// ---------------------------------------------------------------------------
// Status dot — connected / needs attention / not connected
// ---------------------------------------------------------------------------

export type StatusTone = "ok" | "warn" | "idle";

export function StatusDot({ tone, className = "" }: { tone: StatusTone; className?: string }) {
  const color =
    tone === "ok" ? "bg-neon-green" : tone === "warn" ? "bg-neon-amber" : "bg-dim";
  return (
    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${color} ${className}`} />
  );
}

// ---------------------------------------------------------------------------
// Switch — the a11y-friendly toggle (role="switch")
// ---------------------------------------------------------------------------

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
        checked ? "border-neon-green/50 bg-neon-green/25" : "border-line bg-panel"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 rounded-full transition-all ${
          checked ? "left-[1.4rem] bg-neon-green" : "left-0.5 bg-dim"
        }`}
        style={{ height: 22, width: 22 }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// SettingRow — label + plain-English "what this does" + control
// ---------------------------------------------------------------------------

export function SettingRow({
  label,
  blurb,
  control,
  children,
}: {
  label: string;
  blurb?: string;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-star">{label}</p>
          {blurb && (
            <p className="mt-0.5 text-xs leading-relaxed text-dim">{blurb}</p>
          )}
        </div>
        {control && <div className="shrink-0 pt-0.5">{control}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel — one instrument panel (a station's section)
// ---------------------------------------------------------------------------

export function Panel({
  kicker,
  title,
  intro,
  children,
}: {
  kicker: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-teal">
          {kicker}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-star">{title}</h2>
        {intro && (
          <p className="mt-1 text-sm leading-relaxed text-stardust">{intro}</p>
        )}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Inline notice (success / warning / info)
// ---------------------------------------------------------------------------

export function Notice({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "info";
  children: ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "border-neon-green/30 bg-neon-green/5 text-neon-green"
      : tone === "warn"
        ? "border-neon-amber/30 bg-neon-amber/5 text-neon-amber"
        : "border-line bg-panel-2/60 text-stardust";
  return (
    <p role="status" className={`rounded-xl border px-4 py-2.5 text-sm leading-relaxed ${cls}`}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Back chevron (in-panel navigation back to the settings list)
// ---------------------------------------------------------------------------

export function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 flex items-center gap-1.5 text-sm text-stardust transition-colors hover:text-star"
    >
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
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Text input + select + slider primitives (consistent panel styling)
// ---------------------------------------------------------------------------

export const inputCls =
  "w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-teal/60 focus:outline-none disabled:opacity-50";

export function Slider({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-teal-300"
      />
      <div className="mt-0.5 flex justify-between text-[11px] text-dim">
        <span>{min}</span>
        <span className="text-stardust">{value}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-neon-teal/50 bg-neon-teal/10 text-neon-teal"
                : "border-line bg-panel-2/60 text-stardust hover:text-star"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
