import { PageHeader } from "@/components/admin/ui";
import { QueryRunner } from "@/components/admin/query-runner";

export const dynamic = "force-dynamic";

export default function AdminQueryPage() {
  return (
    <div>
      <PageHeader
        title="SQL Query"
        sub="Direct, read-only access to the database for investigations."
      />
      <QueryRunner />
    </div>
  );
}
