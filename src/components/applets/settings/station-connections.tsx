"use client";

import { useCallback, useEffect, useState } from "react";
import { openApplet } from "@/lib/applet-bus";
import { freshnessLabel } from "@/lib/pilot-settings";
import {
  BackButton,
  Notice,
  Panel,
  SettingRow,
  StatusDot,
  type StatusTone,
} from "./settings-ui";

interface CalendarConn {
  id: string;
  provider: string;
  provider_account_email: string | null;
  status: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

interface SchoolConn {
  crew_member_id: string;
  name: string;
  district: string | null;
  sync_status: string;
  last_synced_at: string | null;
}

interface Integration {
  id: string;
  kind: string;
  provider: string;
  status: string;
  connected_at: string;
}

interface CatalogItem {
  kind: string;
  label: string;
  blurb: string;
  connected: boolean;
}

interface ConnectionsData {
  calendars: CalendarConn[];
  school: SchoolConn[];
  integrations: Integration[];
  catalog: CatalogItem[];
}

function providerLabel(provider: string): string {
  if (provider === "google") return "Google Calendar";
  if (provider === "outlook") return "Outlook Calendar";
  return provider;
}

function calendarTone(c: CalendarConn): { tone: StatusTone; text: string } {
  if (c.last_sync_error) return { tone: "warn", text: "Needs attention" };
  if (c.status === "revoked" || c.status === "error")
    return { tone: "warn", text: "Needs attention" };
  return { tone: "ok", text: "Connected" };
}

function schoolTone(s: SchoolConn): { tone: StatusTone; text: string } {
  if (s.sync_status === "error" || s.sync_status === "auth_error")
    return { tone: "warn", text: "Login needs updating" };
  if (!s.last_synced_at) return { tone: "idle", text: "Not connected yet" };
  return { tone: "ok", text: "Connected" };
}

/**
 * Station 2 — Connections.
 * Every data source in one roll-call: calendars, each child's school login,
 * and the integration catalog. Current state is prominent; details on demand.
 * Passwords are never shown or edited here — school logins re-authenticate
 * through the family panel's test-and-save flow.
 */
export function StationConnections({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<ConnectionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/connections");
      if (res.status === 401) {
        setLoading(false);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "load failed");
      setData(json as ConnectionsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your connections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function disconnectCalendar(id: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/calendar/connections/${id}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't disconnect that calendar.");
    } finally {
      setBusyId(null);
    }
  }

  function calendarConnectHref(provider: string): string {
    return `/api/calendar/connect/${provider === "google" ? "google" : "outlook"}`;
  }

  if (loading) {
    return (
      <div aria-busy="true">
        <BackButton onClick={onBack} label="Back to settings" />
        <p className="text-sm text-stardust">Checking your connections…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <BackButton onClick={onBack} label="Back to settings" />
        <Notice tone="warn">
          {error || "We couldn't reach your connections right now."} Try
          reopening this panel.
        </Notice>
      </div>
    );
  }

  const googleConnected = data.calendars.some((c) => c.provider === "google");
  const outlookConnected = data.calendars.some((c) => c.provider === "outlook");

  const connectBtnCls =
    "inline-block rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20";

  return (
    <div>
      <BackButton onClick={onBack} label="Back to settings" />
      <Panel
        kicker="Settings · 2 of 7"
        title="Connections"
        intro="Everything feeding your cockpit — calendars, school logins, and the rest. Each row shows its current state, not just its name."
      >
        {error && <Notice tone="warn">{error}</Notice>}

        {/* Calendars */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
            Calendars
          </p>
          {data.calendars.length === 0 ? (
            <SettingRow
              label="No calendar connected"
              blurb="Connect a calendar and your days organize themselves — meetings, reminders, and school events in one place."
            />
          ) : (
            data.calendars.map((c) => {
              const st = calendarTone(c);
              return (
                <SettingRow
                  key={c.id}
                  label={providerLabel(c.provider)}
                  blurb={`${c.provider_account_email ?? "Account"} · ${freshnessLabel(c.last_synced_at)}`}
                  control={
                    <div className="flex items-center gap-2">
                      <StatusDot tone={st.tone} />
                      <span className={`text-xs font-medium ${st.tone === "warn" ? "text-neon-amber" : st.tone === "ok" ? "text-neon-green" : "text-dim"}`}>
                        {st.text}
                      </span>
                    </div>
                  }
                >
                  {c.last_sync_error && (
                    <p className="text-xs leading-relaxed text-neon-amber">
                      {c.last_sync_error}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <a
                      href={calendarConnectHref(c.provider)}
                      className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star"
                    >
                      Reconnect
                    </a>
                    <button
                      type="button"
                      onClick={() => disconnectCalendar(c.id)}
                      disabled={busyId === c.id}
                      className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
                    >
                      {busyId === c.id ? "Working…" : "Disconnect"}
                    </button>
                  </div>
                </SettingRow>
              );
            })
          )}
          <div className="flex flex-wrap gap-2">
            {!googleConnected && (
              <a href="/api/calendar/connect" className={connectBtnCls}>
                Connect Google Calendar
              </a>
            )}
            {!outlookConnected && (
              <a href="/api/calendar/connect/outlook" className={connectBtnCls}>
                Connect Outlook
              </a>
            )}
          </div>
        </div>

        {/* School logins — per child */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
            School logins
          </p>
          {data.school.length === 0 ? (
            <SettingRow
              label="No children added yet"
              blurb="When you add a child to your crew, their school login shows up here — with its sync state, never its password."
            >
              <button
                type="button"
                onClick={() => openApplet("crew", {}, { replace: true })}
                className="rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20"
              >
                Add a child
              </button>
            </SettingRow>
          ) : (
            data.school.map((s) => {
              const st = schoolTone(s);
              return (
                <SettingRow
                  key={s.crew_member_id}
                  label={`${s.name}'s school`}
                  blurb={`${s.district ?? "School portal"} · ${freshnessLabel(s.last_synced_at)}`}
                  control={
                    <div className="flex items-center gap-2">
                      <StatusDot tone={st.tone} />
                      <span className={`text-xs font-medium ${st.tone === "warn" ? "text-neon-amber" : st.tone === "ok" ? "text-neon-green" : "text-dim"}`}>
                        {st.text}
                      </span>
                    </div>
                  }
                >
                  <button
                    type="button"
                    onClick={() => openApplet("crew", {}, { replace: true })}
                    className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star"
                  >
                    {st.tone === "idle" ? "Connect school login" : "Update login"}
                  </button>
                  <p className="mt-2 text-[11px] leading-relaxed text-dim">
                    Passwords are tested and stored securely — never shown here.
                  </p>
                </SettingRow>
              );
            })
          )}
        </div>

        {/* Everything else */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
            Everything else
          </p>
          {data.catalog.map((item) => {
            const integ = data.integrations.find((i) => i.kind === item.kind);
            const tone: StatusTone = integ
              ? integ.status === "connected"
                ? "ok"
                : "warn"
              : "idle";
            return (
              <SettingRow
                key={item.kind}
                label={item.label}
                blurb={item.blurb}
                control={
                  <div className="flex items-center gap-2">
                    <StatusDot tone={tone} />
                    <span className={`text-xs font-medium ${tone === "ok" ? "text-neon-green" : tone === "warn" ? "text-neon-amber" : "text-dim"}`}>
                      {integ
                        ? integ.status === "connected"
                          ? "Connected"
                          : "Needs attention"
                        : "Not connected yet"}
                    </span>
                  </div>
                }
              >
                {integ ? (
                  <p className="text-xs text-dim">
                    {integ.provider} · connected{" "}
                    {new Date(integ.connected_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                ) : (
                  <p className="text-xs text-dim">
                    Still being built — nothing to connect here yet, and nothing
                    is quietly reading your data in the meantime.
                  </p>
                )}
              </SettingRow>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
