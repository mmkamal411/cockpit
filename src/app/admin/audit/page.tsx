import { adminGetSafe } from "@/lib/admin/api";
import type { AuditResponse } from "@/lib/admin/types";
import { PageHeader, ErrorCard } from "@/components/admin/ui";
import { AuditBrowser } from "@/components/admin/audit-browser";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const actor = typeof sp.actor === "string" ? sp.actor : "";
  const action = typeof sp.action === "string" ? sp.action : "";
  const targetType = typeof sp.target_type === "string" ? sp.target_type : "";
  const pageRaw = typeof sp.page === "string" ? parseInt(sp.page, 10) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const apiParams = new URLSearchParams({
    actor,
    action,
    target_type: targetType,
    page: String(page),
    limit: "25",
  });

  const { data, error } = await adminGetSafe<AuditResponse>(
    `/api/admin/audit?${apiParams.toString()}`,
  );

  return (
    <div>
      <PageHeader
        title="Audit Log"
        sub="Every privileged admin action, newest first. Click a row to see what changed."
      />
      {error || !data ? (
        <ErrorCard title="The audit log is unavailable right now" detail={error ?? undefined} />
      ) : (
        <AuditBrowser
          entries={data.entries ?? []}
          total={data.total ?? 0}
          actor={actor}
          action={action}
          targetType={targetType}
          page={page}
        />
      )}
    </div>
  );
}
