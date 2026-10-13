"use client";

import { Fragment, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuditEntry } from "@/lib/admin/types";
import { auditActor } from "@/lib/admin/types";
import { DataTable, EmptyState, formatTime } from "@/components/admin/ui";

/**
 * Audit log browser: filters by actor / action / target type, paginated,
 * expandable rows showing a key-by-key before/after diff.
 */

const LIMIT = 25;

function JsonValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-dim">null</span>;
  if (typeof value === "object") {
    const s = JSON.stringify(value, null, 2);
    return <pre className="whitespace-pre-wrap break-all">{s}</pre>;
  }
  return <span>{String(value)}</span>;
}

function Diff({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));

  if (keys.length === 0) {
    return <p className="text-xs text-dim">No before/after snapshot recorded for this entry.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <div className="rounded-lg border border-white/10 bg-black/60 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-dim">
          Before
        </p>
        <div className="flex flex-col gap-1 font-mono text-xs text-stardust">
          {keys.map((k) => (
            <div key={k} className={JSON.stringify(b[k]) !== JSON.stringify(a[k]) ? "rounded bg-amber-400/10 px-1" : ""}>
              <span className="text-cyan-300">{k}</span>
              <span className="text-dim">: </span>
              <JsonValue value={b[k]} />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-white/10 bg-black/60 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-dim">
          After
        </p>
        <div className="flex flex-col gap-1 font-mono text-xs text-stardust">
          {keys.map((k) => (
            <div key={k} className={JSON.stringify(b[k]) !== JSON.stringify(a[k]) ? "rounded bg-green-400/10 px-1" : ""}>
              <span className="text-cyan-300">{k}</span>
              <span className="text-dim">: </span>
              <JsonValue value={a[k]} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AuditBrowser({
  entries,
  total,
  actor,
  action,
  targetType,
  page,
}: {
  entries: AuditEntry[];
  total: number;
  actor: string;
  action: string;
  targetType: string;
  page: number;
}) {
  const router = useRouter();
  const [actorDraft, setActorDraft] = useState(actor);
  const [actionDraft, setActionDraft] = useState(action);
  const [targetDraft, setTargetDraft] = useState(targetType);
  const [expanded, setExpanded] = useState<string | null>(null);

  const pushParams = (patch: Record<string, string | number>) => {
    const params = new URLSearchParams();
    const merged = { actor, action, target_type: targetType, page, ...patch } as Record<
      string,
      string | number
    >;
    for (const [k, v] of Object.entries(merged)) {
      const s = String(v);
      if (s !== "") params.set(k, s);
    }
    router.push(`/admin/audit?${params.toString()}`);
  };

  const searchTimer = useRef<number | undefined>(undefined);
  const scheduleApply = () =>
    window.setTimeout(() => {
      pushParams({
        actor: actorDraft,
        action: actionDraft,
        target_type: targetDraft,
        page: 1,
      });
    }, 400);
  const onFilter = () => {
    window.clearTimeout(searchTimer.current);
    searchTimer.current = scheduleApply();
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const inputClass =
    "rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-star placeholder:text-dim focus:border-cyan-400/60 focus:outline-none";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-dim">Actor</span>
          <input
            type="text"
            value={actorDraft}
            onChange={(e) => {
              setActorDraft(e.target.value);
              onFilter();
            }}
            placeholder="admin email…"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-dim">Action</span>
          <input
            type="text"
            value={actionDraft}
            onChange={(e) => {
              setActionDraft(e.target.value);
              onFilter();
            }}
            placeholder="user.suspend…"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-dim">Target type</span>
          <input
            type="text"
            value={targetDraft}
            onChange={(e) => {
              setTargetDraft(e.target.value);
              onFilter();
            }}
            placeholder="pilot…"
            className={inputClass}
          />
        </label>
        <span className="ml-auto font-mono text-xs text-dim">
          {total} {total === 1 ? "entry" : "entries"}
        </span>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No audit entries match"
          hint="Try loosening the filters."
        />
      ) : (
        <>
          <DataTable
            head={
              <>
                <th className="px-3 py-2 w-10" aria-hidden="true" />
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">ID</th>
              </>
            }
          >
            {entries.map((e) => {
              const isOpen = expanded === e.id;
              return (
                <Fragment key={e.id}>
                  <tr
                    className="text-stardust hover:bg-white/[0.03] cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : e.id)}
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        setExpanded(isOpen ? null : e.id);
                      }
                    }}
                    aria-expanded={isOpen}
                  >
                    <td className="px-3 py-2.5 text-dim" aria-hidden="true">
                      {isOpen ? "▾" : "▸"}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-dim">
                      {formatTime(e.created_at)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{auditActor(e)}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-cyan-300">
                      {e.action}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {e.target_type ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-dim">
                      {e.target_id ?? "—"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-white/[0.02]">
                      <td colSpan={6} className="px-3 py-4">
                        <Diff before={e.before} after={e.after} />
                        {e.metadata != null && (
                          <div className="mt-3 rounded-lg border border-white/10 bg-black/60 p-3">
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-dim">
                              Context
                            </p>
                            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-stardust">
                              {JSON.stringify(e.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </DataTable>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => pushParams({ page: page - 1 })}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-stardust disabled:opacity-40 hover:border-cyan-400/40 hover:text-cyan-200 disabled:hover:border-white/15 disabled:hover:text-stardust"
            >
              ← Prev
            </button>
            <span className="font-mono text-xs text-dim">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => pushParams({ page: page + 1 })}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-stardust disabled:opacity-40 hover:border-cyan-400/40 hover:text-cyan-200 disabled:hover:border-white/15 disabled:hover:text-stardust"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
