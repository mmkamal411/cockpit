import Link from "next/link";
import { adminGetSafe } from "@/lib/admin/api";
import type { TableInfo, TablesResponse } from "@/lib/admin/types";
import { PageHeader, ErrorCard, EmptyState } from "@/components/admin/ui";

export const instant = false;

function normalizeTables(data: TableInfo[] | TablesResponse | null): TableInfo[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.tables)) return data.tables;
  return [];
}

export default async function AdminTablesPage() {
  const { data, error } = await adminGetSafe<TableInfo[] | TablesResponse>("/api/admin/tables");
  const tables = normalizeTables(data);

  return (
    <div>
      <PageHeader title="Tables" sub="Every table in the database, with live row counts." />
      {error ? (
        <ErrorCard title="The table list is unavailable right now" detail={error} />
      ) : tables.length === 0 ? (
        <EmptyState title="No tables found" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tables.map((t) => (
            <Link
              key={t.name}
              href={`/admin/tables/${encodeURIComponent(t.name)}`}
              className="group rounded-xl border border-white/10 bg-black/70 p-4 hover:border-cyan-400/40"
            >
              <p className="font-mono text-sm font-medium text-cyan-300 group-hover:text-cyan-200">
                {t.name}
              </p>
              <p className="mt-2 font-mono text-2xl text-star">{t.row_count ?? 0}</p>
              <p className="text-[11px] uppercase tracking-wider text-dim">rows</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
