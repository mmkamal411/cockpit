import { PageHeader } from "@/components/admin/ui";
import { QueryRunner } from "@/components/admin/query-runner";

export const instant = false;

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
