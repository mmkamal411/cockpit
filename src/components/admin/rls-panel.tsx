"use client";

import { useState } from "react";
import type { RlsInfo } from "@/lib/admin/types";
import { Pill } from "@/components/admin/ui";

/** Collapsible RLS policy inspector for a table. */
export function RlsPanel({ rls }: { rls: RlsInfo | null }) {
  const [open, setOpen] = useState(false);

  if (!rls) {
    return (
      <div className="mb-5 rounded-xl border border-white/10 bg-black/60 px-4 py-3">
        <p className="text-xs text-dim">RLS policy info is unavailable for this table.</p>
      </div>
    );
  }

  return (
    <div className="mb-5 rounded-xl border border-white/10 bg-black/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 rounded-xl"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stardust">
            RLS policies
          </span>
          {rls.rls_enabled ? (
            <Pill tone="green">RLS enabled</Pill>
          ) : (
            <Pill tone="red">RLS disabled</Pill>
          )}
          {rls.rls_forced && <Pill tone="amber">Forced</Pill>}
          <span className="font-mono text-xs text-dim">
            {(rls.policies ?? []).length} policies
          </span>
        </span>
        <span className="text-dim" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/10 px-4 py-3">
          {(rls.policies ?? []).length === 0 ? (
            <p className="py-2 text-sm text-dim">
              No policies defined — every role is denied when RLS is on.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {rls.policies.map((p, i) => (
                <div
                  key={`${p.name}-${i}`}
                  className="rounded-lg border border-white/10 bg-black/50 px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-star">
                      {p.name}
                    </span>
                    <Pill tone="muted">{p.command}</Pill>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 font-mono text-[11px] md:grid-cols-3">
                    <div>
                      <span className="text-dim">roles: </span>
                      <span className="text-stardust">
                        {p.roles?.join(", ") ?? "—"}
                      </span>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-dim">using: </span>
                      <span className="break-all text-stardust">{p.using ?? "—"}</span>
                    </div>
                    <div className="md:col-span-3">
                      <span className="text-dim">with check: </span>
                      <span className="break-all text-stardust">{p.with_check ?? "—"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
