"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TableData } from "@/lib/admin/types";
import { DataTable, EmptyState, formatCell } from "@/components/admin/ui";
import { ExportButtons } from "@/components/admin/export-buttons";

/**
 * Table data grid: search, sortable columns, pagination — all driven by
 * the URL search params so the server page refetches. Sticky headers,
 * monospace cells, export buttons up top.
 */

const LIMIT = 50;

export function TableBrowser({
  tableName,
  data,
  q,
  sort,
  order,
  page,
}: {
  tableName: string;
  data: TableData;
  q: string;
  sort: string;
  order: string;
  page: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(q);

  const pushParams = (patch: Record<string, string | number>) => {
    const params = new URLSearchParams();
    const merged = { q, sort, order, page, ...patch } as Record<string, string | number>;
    for (const [k, v] of Object.entries(merged)) {
      const s = String(v);
      if (s !== "") params.set(k, s);
    }
    router.push(`/admin/tables/${encodeURIComponent(tableName)}?${params.toString()}`);
  };

  const searchTimer = useRef<number | undefined>(undefined);
  const onSearch = (value: string) => {
    setDraft(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => pushParams({ q: value, page: 1 }), 400);
  };

  const toggleSort = (key: string) => {
    if (sort === key) {
      pushParams({ order: order === "asc" ? "desc" : "asc", page: 1 });
    } else {
      pushParams({ sort: key, order: "asc", page: 1 });
    }
  };

  const columns = data.columns ?? [];
  const rows = data.rows ?? [];
  const total = data.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={draft}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={`Search ${tableName}…`}
          aria-label={`Search ${tableName}`}
          className="w-full max-w-sm rounded-lg border border-white/15 bg-black/60 px-3 py-2 font-mono text-sm text-star placeholder:text-dim focus:border-cyan-400/60 focus:outline-none"
        />
        <span className="font-mono text-xs text-dim">
          {total} {total === 1 ? "row" : "rows"}
        </span>
        <div className="ml-auto">
          <ExportButtons tableName={tableName} />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={q ? "No rows match that search" : "This table is empty"}
          hint={q ? "Try a different search term." : undefined}
        />
      ) : (
        <>
          <DataTable
            head={
              <>
                {columns.map((col) => (
                  <th key={col} className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleSort(col)}
                      className="font-mono normal-case tracking-normal hover:text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 rounded"
                      aria-label={`Sort by ${col}`}
                    >
                      {col}
                      {sort === col && (order === "asc" ? " ▲" : " ▼")}
                    </button>
                  </th>
                ))}
              </>
            }
          >
            {rows.map((row, i) => (
              <tr key={i} className="font-mono text-xs text-stardust hover:bg-white/[0.03]">
                {columns.map((col) => (
                  <td key={col} className="max-w-[320px] truncate px-3 py-2" title={formatCell(row[col])}>
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
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
