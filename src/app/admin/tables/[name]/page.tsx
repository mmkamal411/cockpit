import Link from "next/link";
import { adminGetSafe } from "@/lib/admin/api";
import type { RlsInfo, TableData } from "@/lib/admin/types";
import { PageHeader, ErrorCard } from "@/components/admin/ui";
import { TableBrowser } from "@/components/admin/table-browser";
import { RlsPanel } from "@/components/admin/rls-panel";

export const dynamic = "force-dynamic";

export default async function AdminTableDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { name } = await params;
  const tableName = decodeURIComponent(name);

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const sort = typeof sp.sort === "string" ? sp.sort : "";
  const orderRaw = typeof sp.order === "string" ? sp.order : "asc";
  const order = orderRaw === "desc" ? "desc" : "asc";
  const pageRaw = typeof sp.page === "string" ? parseInt(sp.page, 10) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const apiParams = new URLSearchParams({
    q,
    sort,
    order,
    page: String(page),
    limit: "50",
  });
  const encoded = encodeURIComponent(tableName);

  const [table, rls] = await Promise.all([
    adminGetSafe<TableData>(`/api/admin/tables/${encoded}?${apiParams.toString()}`),
    adminGetSafe<RlsInfo>(`/api/admin/tables/${encoded}/policies`),
  ]);

  return (
    <div>
      <PageHeader
        title={tableName}
        sub="Live rows from the database. Sorting and search run server-side."
        actions={
          <Link
            href="/admin/tables"
            className="text-sm text-cyan-300 hover:text-cyan-200"
          >
            ← All tables
          </Link>
        }
      />

      <RlsPanel rls={rls.data} />

      {table.error || !table.data ? (
        <ErrorCard title="This table is unavailable right now" detail={table.error ?? undefined} />
      ) : (
        <TableBrowser
          tableName={tableName}
          data={table.data}
          q={q}
          sort={sort}
          order={order}
          page={page}
        />
      )}
    </div>
  );
}
