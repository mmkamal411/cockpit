"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminUser } from "@/lib/admin/types";
import { Pill, DataTable, EmptyState, formatTime } from "@/components/admin/ui";

/**
 * User directory: search box, sortable columns, suspended badges,
 * pagination. Drives the URL search params so the server page refetches.
 */

const LIMIT = 25;

const SORTABLE: { key: string; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "display_name", label: "Name" },
  { key: "created_at", label: "Joined" },
];

export function UsersBrowser({
  users,
  total,
  q,
  sort,
  order,
  page,
}: {
  users: AdminUser[];
  total: number;
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
    router.push(`/admin/users?${params.toString()}`);
  };

  // Debounced search: update the URL 400ms after the user stops typing.
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
      pushParams({ sort: key, order: key === "email" || key === "display_name" ? "asc" : "desc", page: 1 });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={draft}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by email or name…"
          aria-label="Search users"
          className="w-full max-w-sm rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-star placeholder:text-dim focus:border-cyan-400/60 focus:outline-none"
        />
        <span className="font-mono text-xs text-dim">
          {total} {total === 1 ? "pilot" : "pilots"}
        </span>
      </div>

      {users.length === 0 ? (
        <EmptyState
          title={q ? "No users match that search" : "No pilots yet"}
          hint={q ? "Try a different email or name." : undefined}
        />
      ) : (
        <>
          <DataTable
            head={
              <>
                {SORTABLE.map((col) => (
                  <th key={col.key} className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="uppercase tracking-wider hover:text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 rounded"
                      aria-label={`Sort by ${col.label}`}
                    >
                      {col.label}
                      {sort === col.key && (order === "asc" ? " ▲" : " ▼")}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2" aria-hidden="true" />
              </>
            }
          >
            {users.map((u) => (
              <tr key={u.id} className="text-stardust hover:bg-white/[0.03]">
                <td className="px-3 py-2.5 font-mono text-xs text-star">{u.email}</td>
                <td className="px-3 py-2.5">{u.display_name ?? "—"}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-dim">
                  {formatTime(u.created_at)}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs">{u.crew_count ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-xs">
                  {u.integration_count ?? 0}
                </td>
                <td className="px-3 py-2.5">
                  {u.suspended ? <Pill tone="red">Suspended</Pill> : <Pill tone="green">Active</Pill>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Link
                    href={`/admin/users/${encodeURIComponent(u.id)}`}
                    className="text-xs font-medium text-cyan-300 hover:text-cyan-200"
                  >
                    Inspect
                  </Link>
                </td>
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
