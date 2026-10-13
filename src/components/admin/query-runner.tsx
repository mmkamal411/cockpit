"use client";

import { useState } from "react";
import type { QueryResult } from "@/lib/admin/types";
import {
  Panel,
  Pill,
  DataTable,
  EmptyState,
  SkeletonTable,
  formatCell,
} from "@/components/admin/ui";

/**
 * Read-only SQL console. The banner states the rule loudly; a client-side
 * pre-check blocks non-SELECT/WITH statements before they ever leave the
 * browser. The server enforces the rule too.
 */

const MAX_DISPLAY_ROWS = 500;

function isReadOnly(sql: string): boolean {
  // Strip leading comments and whitespace, then require SELECT or WITH.
  const stripped = sql
    .replace(/^\s*--[^\n]*(\n|$)/gm, "")
    .replace(/^\s*\/\*[\s\S]*?\*\//, "")
    .trim();
  return /^(select|with)\b/i.test(stripped);
}

export function QueryRunner() {
  const [sql, setSql] = useState(
    "select id, actor_email, action, created_at\nfrom admin_audit_log\norder by created_at desc\nlimit 25;",
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setResult(null);
    if (sql.trim() === "") {
      setError("Write a query first.");
      return;
    }
    if (!isReadOnly(sql)) {
      setError(
        "Blocked: only SELECT and WITH queries are allowed. Writes (INSERT, UPDATE, DELETE, DROP, …) are never executed from this console.",
      );
      return;
    }
    setRunning(true);
    try {
      const res = await fetch("/api/admin/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sql }),
      });
      const body = (await res.json().catch(() => ({}))) as QueryResult & {
        error?: string;
      };
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setRunning(false);
    }
  };

  const columns = result?.columns ?? [];
  const rows = result?.rows ?? [];
  const truncated = rows.length > MAX_DISPLAY_ROWS;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3">
        <p className="text-sm font-semibold text-amber-300">
          READ-ONLY — only SELECT / WITH queries are allowed.
        </p>
        <p className="mt-1 text-xs text-dim">
          Anything else is blocked in the browser and rejected by the server.
        </p>
      </div>

      <Panel title="Query editor" tone="cyan">
        <label htmlFor="admin-sql" className="sr-only">
          SQL query
        </label>
        <textarea
          id="admin-sql"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={8}
          spellCheck={false}
          className="w-full rounded-lg border border-white/15 bg-black/80 p-3 font-mono text-sm leading-relaxed text-star placeholder:text-dim focus:border-cyan-400/60 focus:outline-none"
          placeholder="select * from pilots limit 10;"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-xs text-dim">
            {result ? `${rows.length} row${rows.length === 1 ? "" : "s"} returned` : " "}
          </span>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded-lg border border-cyan-400/50 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-40"
          >
            {running ? "Running…" : "Run query"}
          </button>
        </div>
      </Panel>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-black/70 px-4 py-4">
          <div className="flex items-center gap-2">
            <Pill tone="red">Error</Pill>
            <p className="text-sm font-semibold text-red-300">The query failed</p>
          </div>
          <p className="mt-2 whitespace-pre-wrap font-mono text-xs break-words text-stardust">
            {error}
          </p>
        </div>
      )}

      {running && <SkeletonTable rows={6} cols={4} />}

      {result && !running && (
        <Panel title="Results" tone="muted">
          {rows.length === 0 ? (
            <EmptyState title="No rows returned" />
          ) : (
            <>
              {truncated && (
                <p className="mb-3 text-xs text-amber-300">
                  Showing the first {MAX_DISPLAY_ROWS} rows.
                </p>
              )}
              <DataTable
                head={
                  <>
                    {columns.map((c) => (
                      <th key={c} className="px-3 py-2 font-mono normal-case tracking-normal">
                        {c}
                      </th>
                    ))}
                  </>
                }
              >
                {rows.slice(0, MAX_DISPLAY_ROWS).map((row, i) => (
                  <tr key={i} className="font-mono text-xs text-stardust hover:bg-white/[0.03]">
                    {columns.map((c) => (
                      <td
                        key={c}
                        className="max-w-[320px] truncate px-3 py-2"
                        title={formatCell(row[c])}
                      >
                        {formatCell(row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </DataTable>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
