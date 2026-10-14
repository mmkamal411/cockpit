"use client";

import { useState } from "react";
import Link from "next/link";
import type { AuditEntry, UserDetail } from "@/lib/admin/types";
import { auditActor } from "@/lib/admin/types";
import {
  Panel,
  Pill,
  StatCard,
  DataTable,
  EmptyState,
  formatTime,
} from "@/components/admin/ui";
import { DangerZone } from "@/components/admin/danger-zone";
import { ViewAsPanel } from "@/components/admin/view-as-panel";

/**
 * User detail tabs: Overview | Crew | Integrations | Audit Trail | Danger Zone.
 * Receives the full detail payload from the server page.
 */

const TABS = ["Overview", "Crew", "Integrations", "Audit Trail", "Danger Zone"] as const;
type Tab = (typeof TABS)[number];

function pilotField(detail: UserDetail, key: string): unknown {
  const p = detail.pilot;
  if (p && typeof p === "object") return (p as Record<string, unknown>)[key];
  return undefined;
}

export function UserTabs({ userId, detail }: { userId: string; detail: UserDetail }) {
  const [tab, setTab] = useState<Tab>("Overview");

  const email = detail.auth?.email ?? String(pilotField(detail, "email") ?? "—");
  const displayName = String(pilotField(detail, "display_name") ?? "—");
  const createdAt = String(pilotField(detail, "created_at") ?? "");
  const suspended = Boolean(pilotField(detail, "suspended"));
  const pilotId = String(pilotField(detail, "id") ?? userId);

  const counts = detail.counts ?? {};
  const countEntries = Object.entries(counts);

  return (
    <div>
      {/* Profile header */}
      <div className="mb-5 rounded-xl border border-cyan-400/25 bg-black/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-star">{displayName}</h1>
            <p className="mt-0.5 font-mono text-xs text-stardust">{email}</p>
          </div>
          {suspended ? <Pill tone="red">Suspended</Pill> : <Pill tone="green">Active</Pill>}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 font-mono text-xs text-dim sm:grid-cols-3">
          <div>
            Pilot ID: <span className="text-stardust">{pilotId}</span>
          </div>
          <div>
            Joined: <span className="text-stardust">{formatTime(createdAt)}</span>
          </div>
          <div>
            Last sign-in:{" "}
            <span className="text-stardust">{formatTime(detail.auth?.last_sign_in_at)}</span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div role="tablist" aria-label="User sections" className="mb-5 flex flex-wrap gap-1">
        {TABS.map((t) => {
          const active = tab === t;
          const danger = t === "Danger Zone";
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                active
                  ? danger
                    ? "border-red-500/50 bg-red-500/10 text-red-200"
                    : "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                  : "border-transparent text-stardust hover:border-white/10 hover:bg-white/5 hover:text-star"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>

      {tab === "Overview" && (
        <div className="flex flex-col gap-6">
          <Panel title="Record counts" tone="cyan">
            {countEntries.length === 0 ? (
              <EmptyState title="No counts returned" />
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {countEntries.map(([k, v]) => (
                  <StatCard key={k} label={k.replace(/_/g, " ")} value={v} tone="muted" />
                ))}
              </div>
            )}
          </Panel>
          <ViewAsPanel userId={userId} />
        </div>
      )}

      {tab === "Crew" && (
        <Panel title={`Crew members (${detail.crew?.length ?? 0})`} tone="purple">
          {(detail.crew ?? []).length === 0 ? (
            <EmptyState title="No crew members linked" hint="This pilot has not added any children yet." />
          ) : (
            <DataTable
              head={
                <>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Relationship</th>
                  <th className="px-3 py-2">Age tier</th>
                </>
              }
            >
              {detail.crew.map((c) => (
                <tr key={c.id} className="text-stardust">
                  <td className="px-3 py-2.5 font-mono text-xs text-dim">{c.id}</td>
                  <td className="px-3 py-2.5 text-star">{c.display_name ?? "—"}</td>
                  <td className="px-3 py-2.5">{c.relationship ?? "—"}</td>
                  <td className="px-3 py-2.5">{c.age_tier ?? "—"}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      )}

      {tab === "Integrations" && (
        <Panel title={`Integrations (${detail.integrations?.length ?? 0})`} tone="cyan">
          {(detail.integrations ?? []).length === 0 ? (
            <EmptyState title="No integrations connected" />
          ) : (
            <DataTable
              head={
                <>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last sync</th>
                </>
              }
            >
              {detail.integrations.map((i) => (
                <tr key={i.id} className="text-stardust">
                  <td className="px-3 py-2.5 font-medium text-star">{i.provider}</td>
                  <td className="px-3 py-2.5">
                    <Pill tone={i.status === "ok" ? "green" : "amber"}>{i.status}</Pill>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-dim">
                    {formatTime(i.last_sync_at)}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      )}

      {tab === "Audit Trail" && (
        <Panel title="Recent activity on this account" tone="muted">
          {(detail.recent_audit ?? []).length === 0 ? (
            <EmptyState title="No audit entries for this user" />
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
              {detail.recent_audit.map((e: AuditEntry) => (
                <tr key={e.id} className="text-stardust">
                  <td className="px-3 py-2.5 font-mono text-xs text-dim">
                    {formatTime(e.created_at)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{auditActor(e)}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-cyan-300">{e.action}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {e.target_type ? `${e.target_type}:${e.target_id ?? ""}` : "—"}
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      )}

      {tab === "Danger Zone" && (
        <DangerZone userId={userId} email={email} suspended={suspended} />
      )}

      <div className="mt-6">
        <Link href="/admin/users" className="text-sm text-cyan-300 hover:text-cyan-200">
          ← Back to users
        </Link>
      </div>
    </div>
  );
}
