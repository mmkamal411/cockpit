import type { ReactNode } from "react";

/**
 * Shared admin UI primitives — dark cockpit command-center language:
 * black panels, neon accent borders, bright text, monospace data.
 */

export type Tone = "cyan" | "green" | "red" | "amber" | "purple" | "muted";

const TONE_BORDER: Record<Tone, string> = {
  cyan: "border-cyan-400/30",
  green: "border-green-400/30",
  red: "border-red-500/40",
  amber: "border-amber-400/30",
  purple: "border-purple-400/30",
  muted: "border-white/10",
};

const TONE_TEXT: Record<Tone, string> = {
  cyan: "text-cyan-300",
  green: "text-green-300",
  red: "text-red-300",
  amber: "text-amber-300",
  purple: "text-purple-300",
  muted: "text-dim",
};

export function Panel({
  title,
  right,
  tone = "muted",
  children,
  className = "",
}: {
  title?: string;
  right?: ReactNode;
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border ${TONE_BORDER[tone]} bg-black/70 backdrop-blur-sm ${className}`}
    >
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          {title && (
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-stardust">
              {title}
            </h2>
          )}
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-star">{title}</h1>
        {sub && <p className="mt-1 text-sm text-dim">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${TONE_BORDER[tone]} ${TONE_TEXT[tone]} bg-white/[0.02]`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  tone = "cyan",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className={`rounded-xl border ${TONE_BORDER[tone]} bg-black/70 p-4`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim">
        {label}
      </div>
      <div className={`mt-1 font-mono text-3xl font-semibold ${TONE_TEXT[tone]}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-dim">{hint}</div>}
    </div>
  );
}

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse" aria-label="Loading">
      <table className="w-full">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-white/5">
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="px-3 py-3">
                  <div className="h-3.5 rounded bg-white/10" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/50 px-4 py-10 text-center">
      <p className="text-sm font-medium text-stardust">{title}</p>
      {hint && <p className="mt-1 text-xs text-dim">{hint}</p>}
    </div>
  );
}

/** Plain-English error card — an admin tool never shows a blank page. */
export function ErrorCard({
  title,
  detail,
  retry,
}: {
  title: string;
  detail?: string;
  retry?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-red-500/40 bg-black/70 px-4 py-6 text-center">
      <p className="text-sm font-semibold text-red-300">{title}</p>
      {detail && (
        <p className="mx-auto mt-2 max-w-xl font-mono text-xs break-all text-dim">{detail}</p>
      )}
      {retry && <div className="mt-4">{retry}</div>}
    </div>
  );
}

/** Dense, sticky-header admin data table wrapper. */
export function DataTable({
  head,
  children,
}: {
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/70">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-panel-3/95 backdrop-blur">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-dim">
            {head}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">{children}</tbody>
      </table>
    </div>
  );
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Render an arbitrary DB cell value safely. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    try {
      const s = JSON.stringify(value);
      return s.length > 120 ? `${s.slice(0, 117)}…` : s;
    } catch {
      return "[object]";
    }
  }
  const s = String(value);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}
