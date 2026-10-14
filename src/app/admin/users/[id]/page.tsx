import { adminGetSafe } from "@/lib/admin/api";
import type { UserDetail } from "@/lib/admin/types";
import { ErrorCard } from "@/components/admin/ui";
import { UserTabs } from "@/components/admin/user-tabs";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data, error } = await adminGetSafe<UserDetail>(
    `/api/admin/users/${encodeURIComponent(id)}`,
  );

  if (error || !data) {
    return (
      <ErrorCard
        title="Could not load this user"
        detail={error ?? "The API returned an empty response."}
      />
    );
  }

  return <UserTabs userId={id} detail={data} />;
}
