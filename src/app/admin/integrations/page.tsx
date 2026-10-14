import { adminGetSafe } from "@/lib/admin/api";
import type { IntegrationStatus } from "@/lib/admin/types";
import { PageHeader, ErrorCard, EmptyState } from "@/components/admin/ui";
import { IntegrationCard } from "@/components/admin/integration-card";

export const dynamic = "force-dynamic";

export default async function AdminIntegrationsPage() {
  const { data, error } = await adminGetSafe<IntegrationStatus[]>("/api/admin/integrations");
  const integrations = data ?? [];

  return (
    <div>
      <PageHeader
        title="Integrations"
        sub="Third-party connections and their live health. Test a connection any time."
      />
      {error ? (
        <ErrorCard title="Integration status is unavailable right now" detail={error} />
      ) : integrations.length === 0 ? (
        <EmptyState title="No integrations registered" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {integrations.map((i) => (
            <IntegrationCard key={i.id} integration={i} />
          ))}
        </div>
      )}
    </div>
  );
}
