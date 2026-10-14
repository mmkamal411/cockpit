"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Panel, ErrorCard, SkeletonTable } from "@/components/admin/ui";

/** Recursive, defensive JSON viewer for the read-only view-as payload. */
function JsonNode({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined)
    return <span className="text-dim">null</span>;
  if (typeof value === "string")
    return <span className="break-all text-green-300">“{value}”</span>;
  if (typeof value === "number" || typeof value === "boolean")
    return <span className="text-amber-300">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-dim">[]</span>;
    if (depth > 3) return <span className="text-dim">[{value.length} items]</span>;
    return (
      <div className="pl-3">
        {value.slice(0, 20).map((v, i) => (
          <div key={i} className="border-l border-white/10 pl-2">
            <JsonNode value={v} depth={depth + 1} />
          </div>
        ))}
        {value.length > 20 && (
          <div className="text-dim">… {value.length - 20} more</div>
        )}
      </div>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-dim">{"{}"}</span>;
    return (
      <div className="pl-3">
        {entries.slice(0, 40).map(([k, v]) => (
          <div key={k} className="border-l border-white/10 pl-2">
            <span className="text-cyan-300">{k}</span>
            <span className="text-dim">: </span>
            <JsonNode value={v} depth={depth + 1} />
          </div>
        ))}
        {entries.length > 40 && (
          <div className="text-dim">… {entries.length - 40} more keys</div>
        )}
      </div>
    );
  }
  return <span className="text-stardust">{String(value)}</span>;
}

/**
 * Read-only "view as pilot" preview — shows what the dashboard would load
 * for this user, without signing in as them.
 */
export function ViewAsPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A5: a 403 means one of the two admin auth layers denied access.
  // Show a plain-English denial with a way back, never a blank panel.
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/users/${encodeURIComponent(userId)}/view-as`, {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 403) {
            const err = new Error(body?.error ?? "You don't have access to this.");
            (err as { denied?: boolean }).denied = true;
            throw err;
          }
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        return body;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (cancelled) return;
        setAccessDenied(err instanceof Error && Boolean((err as { denied?: boolean }).denied));
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <Panel title="Dashboard preview (read-only)" tone="cyan">
      {loading ? (
        <SkeletonTable rows={6} cols={3} />
      ) : error ? (
        <ErrorCard
          title={
            accessDenied
              ? "You don't have access to this preview"
              : "Could not load the pilot's dashboard data"
          }
          detail={error}
          retry={
            accessDenied ? (
              <Link
                href="/admin/users"
                className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-400/20"
              >
                Back to the users list
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="max-h-96 overflow-auto rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-xs applet-scroll">
          <JsonNode value={data} />
        </div>
      )}
    </Panel>
  );
}
