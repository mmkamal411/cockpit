import { adminGetSafe } from "@/lib/admin/api";
import type { UsersResponse } from "@/lib/admin/types";
import { PageHeader, ErrorCard } from "@/components/admin/ui";
import { UsersBrowser } from "@/components/admin/users-browser";

export const instant = false;

const VALID_SORTS = new Set([
  "email",
  "display_name",
  "created_at",
  "crew_count",
  "integration_count",
  "suspended",
]);

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const sortRaw = typeof sp.sort === "string" ? sp.sort : "created_at";
  const sort = VALID_SORTS.has(sortRaw) ? sortRaw : "created_at";
  const orderRaw = typeof sp.order === "string" ? sp.order : "desc";
  const order = orderRaw === "asc" ? "asc" : "desc";
  const pageRaw = typeof sp.page === "string" ? parseInt(sp.page, 10) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const apiParams = new URLSearchParams({
    q,
    sort,
    order,
    page: String(page),
    limit: "25",
  });

  const { data, error } = await adminGetSafe<UsersResponse>(
    `/api/admin/users?${apiParams.toString()}`,
  );

  return (
    <div>
      <PageHeader title="Users" sub="Every pilot on the platform. Select a row to inspect." />
      {error || !data ? (
        <ErrorCard
          title="The user list is unavailable right now"
          detail={error ?? undefined}
        />
      ) : (
        <UsersBrowser
          users={data.users ?? []}
          total={data.total ?? 0}
          q={q}
          sort={sort}
          order={order}
          page={page}
        />
      )}
    </div>
  );
}
