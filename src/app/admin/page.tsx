import Link from "next/link";
import { adminGetSafe } from "@/lib/admin/api";
import type {
  AdminStats,
  AuditEntry,
  AuditResponse,
  IntegrationStatus,
} from "@/lib/admin/types";
import { auditActor } from "@/lib/admin/types";
import {
  Panel,
  PageHeader,
  Pill,
  StatCard,
  ErrorCard,
  DataTable,
  formatTime,
} from "@/components/admin/ui";

export const instant = false;

function statusTone(status: string): "green" | "red" | "amber" | "muted" {
  const s = status.toLowerCase();
  if (s === "ok" || s === "connected" || s === "healthy") return "green";
  if (s === "down" || s === "error" || s === "failed") return "red";
  if (s === "degraded" || s === "warning") return "amber";
  return "muted";
}

export default async function AdminDashboardPage() {
  const [stats, integrations, audit] = await Promise.all([
    adminGetSafe<AdminStats>("/api/admin/stats"),
    adminGetSafe<IntegrationStatus[]>("/api/admin/integrations"),
    adminGetSafe<AuditResponse>("/api/admin/audit?page=1&limit=10"),
  ]);

  const s = stats.data;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        sub="Platform health at a glance — live from the admin API."
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.error || !s ? (
          <div className="col-span-full">
            <ErrorCard
              title="Stats are unavailable right now"
              detail={stats.error ?? undefined}
            />
          </div>
        ) : (
          <>
            <StatCard label="Pilots" value={s.pilots ?? 0} tone="cyan" />
            <StatCard label="Crew members" value={s.crew_members ?? 0} tone="purple" />
            <StatCard
              label="Grade syncs (24h)"
              value={s.grade_syncs_24h ?? 0}
              tone="green"
            />
            <StatCard label="Todos" value={s.todos ?? 0} tone="amber" />
          </>
        )}
      </div>

      {/* Integration health */}
      <div className="mt-6">
        <Panel
          title="Integration health"
          tone="cyan"
          right={
            <Link
              href="/admin/integrations"
              className="text-xs font-medium text-cyan-300 hover:text-cyan-200"
            >
              Manage
            </Link>
          }
        >
          {integrations.error || !integrations.data ? (
            <ErrorCard
              title="Integration status is unavailable right now"
              detail={integrations.error ?? undefined}
            />
          ) : integrations.data.length === 0 ? (
            <p className="py-4 text-center text-sm text-dim">
              No integrations registered yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {integrations.data.map((i) => (
                <div
                  key={i.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/50 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-star">{i.name}</p>
                    <p className="truncate text-xs text-dim">
                      {i.detail || "—"}
                    </p>
                  </div>
                  <Pill tone={statusTone(i.status)}>{i.status}</Pill>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Recent audit */}
      <div className="mt-6">
        <Panel
          title="Recent admin activity"
          tone="muted"
          right={
            <Link
              href="/admin/audit"
              className="text-xs font-medium text-cyan-300 hover:text-cyan-200"
            >
              Full log
            </Link>
          }
        >
          {audit.error || !audit.data ? (
            <ErrorCard
              title="Audit log is unavailable right now"
              detail={audit.error ?? undefined}
            />
          ) : audit.data.entries.length === 0 ? (
            <p className="py-4 text-center text-sm text-dim">
              No admin actions recorded yet.
            </p>
          ) : (
            <DataTable
              head={
                <>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Target</th>
                </>
              }
            >
              {audit.data.entries.map((e: AuditEntry) => (
                <tr key={e.id} className="text-stardust">
                  <td className="px-3 py-2 font-mono text-xs text-dim">
                    {formatTime(e.created_at)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{auditActor(e)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-cyan-300">
                    {e.action}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {e.target_type ? `${e.target_type}:${e.target_id ?? ""}` : "—"}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </div>
  );
}
