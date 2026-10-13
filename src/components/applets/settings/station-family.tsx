"use client";

import { useCallback, useEffect, useState } from "react";
import { openApplet } from "@/lib/applet-bus";
import { freshnessLabel } from "@/lib/pilot-settings";
import { usePanelSettings } from "./use-panel-settings";
import {
  BackButton,
  Notice,
  Panel,
  SettingRow,
  StatusDot,
  Switch,
  type StatusTone,
} from "./settings-ui";
import { SETTING_BLURBS } from "@/lib/pilot-settings";

interface CrewMember {
  id: string;
  name: string;
  birthdate: string | null;
  relationship: string;
  school_sync?: { sync_status: string; last_synced_at: string | null };
}

interface Grant {
  id: string;
  granted_by: string;
  grantee_name: string;
  scope: Record<string, unknown>;
  granted_at: string;
  revoked_at: string | null;
}

interface LinkCode {
  id: string;
  code: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

interface MemberSharing {
  crew_member_id: string;
  name: string;
  grants: Grant[];
  link_codes: LinkCode[];
}

function ageYears(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate + "T00:00:00");
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function ageTier(age: number | null): string {
  if (age === null) return "Age unknown";
  if (age < 13) return "Under 13 — you manage their account";
  if (age < 16) return "13–15 — shared, with a cooling-off rule";
  if (age < 18) return "16–17 — they can take control anytime";
  return "18+ — they're in control";
}

function scopeSummary(scope: Record<string, unknown>): string {
  const keys = Object.keys(scope).filter((k) => scope[k] === true);
  return keys.length > 0 ? keys.join(", ") : "everything";
}

function codeState(code: LinkCode): { text: string; live: boolean } {
  if (code.used_at) return { text: "Used", live: false };
  if (new Date(code.expires_at).getTime() < Date.now())
    return { text: "Expired", live: false };
  return { text: "Live now", live: true };
}

/**
 * Station 6 — Family & sharing.
 * Who's connected, what they can see, and the full audit trail as a timeline.
 * Link-code generation is prominent (D5: link-code only for v1).
 * Per D1/D3: check-ins are shared by default; for 13–15 you see the full text.
 */
export function StationFamily({ onBack }: { onBack: () => void }) {
  const {
    value: family,
    update: updateFamily,
    loading: familyLoading,
    error: familyError,
  } = usePanelSettings("family");

  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [sharing, setSharing] = useState<MemberSharing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [minting, setMinting] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [crewRes, shareRes] = await Promise.all([
        fetch("/api/crew/members"),
        fetch("/api/crew/access-grants"),
      ]);
      if (crewRes.status === 401 || shareRes.status === 401) return;
      const crewJson = await crewRes.json();
      const shareJson = await shareRes.json();
      if (!crewRes.ok) throw new Error(crewJson.error ?? "crew load failed");
      if (!shareRes.ok) throw new Error(shareJson.error ?? "sharing load failed");
      setCrew(crewJson.members ?? []);
      setSharing(shareJson.members ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your family details.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function mintCode(memberId: string) {
    setMinting(memberId);
    setError("");
    try {
      const res = await fetch(`/api/crew/members/${memberId}/link-code`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't make a code.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a code right now.");
    } finally {
      setMinting(null);
    }
  }

  async function revokeGrant(grantId: string) {
    setRevoking(grantId);
    setError("");
    try {
      const res = await fetch(`/api/crew/access-grants/${grantId}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't stop that sharing.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't stop that sharing right now.");
    } finally {
      setRevoking(null);
    }
  }

  if (loading || familyLoading) {
    return (
      <div aria-busy="true">
        <BackButton onClick={onBack} label="Back to settings" />
        <p className="text-sm text-stardust">Loading family &amp; sharing…</p>
      </div>
    );
  }

  return (
    <div>
      <BackButton onClick={onBack} label="Back to settings" />
      <Panel
        kicker="Settings · 6 of 7"
        title="Family &amp; sharing"
        intro="Who's aboard, what they can see, and every sharing change ever made — as a timeline."
      >
        {(error || familyError) && <Notice tone="warn">{error || familyError}</Notice>}

        {/* Who's aboard */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
            Who&apos;s aboard
          </p>
          {crew.length === 0 ? (
            <SettingRow
              label="Nobody yet"
              blurb="Adding a child is completely optional and lives here — never in sign-up. When you add one, their school, check-ins, and sharing controls appear."
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
            crew.map((m) => {
              const age = ageYears(m.birthdate);
              const sync = m.school_sync;
              const tone: StatusTone =
                sync?.sync_status === "error" || sync?.sync_status === "auth_error"
                  ? "warn"
                  : sync?.last_synced_at
                    ? "ok"
                    : "idle";
              const memberSharing = sharing.find((s) => s.crew_member_id === m.id);
              const liveCode = memberSharing?.link_codes.find(
                (c) => codeState(c).live,
              );
              const isOpen = expanded === m.id;
              return (
                <div
                  key={m.id}
                  className="rounded-xl border border-line bg-panel-2/60 px-4 py-3"
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : m.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <StatusDot tone={tone} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-star">{m.name}</p>
                        <p className="truncate text-xs text-dim">
                          {ageTier(age)}
                          {sync?.last_synced_at &&
                            ` · school ${freshnessLabel(sync.last_synced_at)}`}
                          {!sync?.last_synced_at && " · school not connected"}
                        </p>
                      </div>
                    </div>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className={`shrink-0 text-dim transition-transform ${isOpen ? "rotate-180" : ""}`}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div className="mt-3 space-y-3 border-t border-line pt-3">
                      {/* Invite / link code — prominent */}
                      <div>
                        <p className="text-sm font-medium text-star">
                          Invite them aboard
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-dim">
                          Show them this 6-digit code on your screen. They type
                          it into Cockpit and their account links up — for a
                          second parent, or for your child&apos;s own sign-in.
                          One code lives at a time; each expires in 15 minutes.
                        </p>
                        {liveCode ? (
                          <div className="mt-2 rounded-xl border border-neon-teal/40 bg-neon-teal/5 px-4 py-3 text-center">
                            <p
                              className="text-3xl font-bold tracking-[0.35em] text-neon-teal"
                              aria-label={`Link code ${liveCode.code.split("").join(" ")}`}
                            >
                              {liveCode.code}
                            </p>
                            <p className="mt-1 text-xs text-dim">
                              Expires{" "}
                              {new Date(liveCode.expires_at).toLocaleTimeString(undefined, {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => mintCode(m.id)}
                            disabled={minting === m.id}
                            className="mt-2 rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20 disabled:opacity-50"
                          >
                            {minting === m.id ? "Making a code…" : "Make a 6-digit code"}
                          </button>
                        )}
                        {liveCode && (
                          <button
                            type="button"
                            onClick={() => mintCode(m.id)}
                            disabled={minting === m.id}
                            className="mt-2 w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
                          >
                            Make a new code instead
                          </button>
                        )}
                      </div>

                      {/* Who can see what */}
                      <div>
                        <p className="text-sm font-medium text-star">Who can see {m.name}&apos;s data</p>
                        {(memberSharing?.grants.filter((g) => !g.revoked_at) ?? []).length === 0 ? (
                          <p className="mt-1 text-xs leading-relaxed text-dim">
                            Just you. Nobody else has access, and nobody is added
                            automatically.
                          </p>
                        ) : (
                          <ul className="mt-1.5 space-y-1.5">
                            {(memberSharing?.grants ?? [])
                              .filter((g) => !g.revoked_at)
                              .map((g) => (
                                <li
                                  key={g.id}
                                  className="flex items-center justify-between rounded-lg border border-line/60 bg-panel px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm text-star">{g.grantee_name}</p>
                                    <p className="truncate text-xs text-dim">
                                      Sees {scopeSummary(g.scope)} · since{" "}
                                      {new Date(g.granted_at).toLocaleDateString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                      })}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => revokeGrant(g.id)}
                                    disabled={revoking === g.id}
                                    className="shrink-0 rounded-lg border border-line bg-panel-2/60 px-3 py-1.5 text-xs font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
                                  >
                                    {revoking === g.id ? "Working…" : "Stop sharing"}
                                  </button>
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>

                      {/* Audit timeline */}
                      <div>
                        <p className="text-sm font-medium text-star">Sharing history</p>
                        <AuditTimeline
                          grants={memberSharing?.grants ?? []}
                          codes={memberSharing?.link_codes ?? []}
                        />
                      </div>

                      {/* Go independent (16–17) */}
                      {age !== null && age >= 16 && age < 18 && (
                        <div className="rounded-xl border border-line bg-panel px-4 py-3">
                          <p className="text-sm font-medium text-star">
                            Going independent
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-dim">
                            At 16–17 your teen can take full control of their
                            Cockpit anytime — like graduating, not a breakup.
                            You keep what you&apos;ve seen; they own what comes
                            next. For now, make them a link code above so they
                            can sign in with their own account.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Check-in visibility (D1 + D3, locked rules) */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
            Check-in visibility
          </p>
          <SettingRow
            label={`Check-ins: ${family.checkin_shared_by_default ? "shared with you by default" : "private by default"}`}
            blurb={SETTING_BLURBS.checkin_shared_by_default}
            control={
              <Switch
                checked={family.checkin_shared_by_default}
                onChange={(on) => updateFamily({ checkin_shared_by_default: on })}
                label="Check-ins shared by default"
              />
            }
          />
          <SettingRow
            label={`Full check-in text (13–15): ${family.full_checkin_text_13_15 ? "you see everything" : "summaries only"}`}
            blurb={SETTING_BLURBS.full_checkin_text_13_15}
            control={
              <Switch
                checked={family.full_checkin_text_13_15}
                onChange={(on) => updateFamily({ full_checkin_text_13_15: on })}
                label="Full check-in text for ages 13 to 15"
              />
            }
          />
          <p className="text-[11px] leading-relaxed text-dim">
            These are the locked family rules you chose when the family features
            were set up. Changing them here changes what you see going forward.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function AuditTimeline({ grants, codes }: { grants: Grant[]; codes: LinkCode[] }) {
  type Event = { at: string; text: string; tone: StatusTone };
  const events: Event[] = [];
  for (const g of grants) {
    events.push({
      at: g.granted_at,
      text: `Access granted to ${g.grantee_name} (${scopeSummary(g.scope)})`,
      tone: "ok",
    });
    if (g.revoked_at) {
      events.push({
        at: g.revoked_at,
        text: `Access for ${g.grantee_name} stopped`,
        tone: "warn",
      });
    }
  }
  for (const c of codes) {
    const st = codeState(c);
    events.push({
      at: c.created_at,
      text: `Link code made (${st.live ? "live now" : st.text.toLowerCase()})`,
      tone: st.live ? "ok" : "idle",
    });
  }
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (events.length === 0) {
    return (
      <p className="mt-1 text-xs leading-relaxed text-dim">
        Nothing shared yet — the history starts here when it does.
      </p>
    );
  }
  return (
    <ol className="mt-2 space-y-0">
      {events.slice(0, 12).map((e, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center" aria-hidden="true">
            <StatusDot tone={e.tone} className="mt-1.5" />
            {i < events.length - 1 && <span className="w-px flex-1 bg-line/60" />}
          </div>
          <div className="pb-3">
            <p className="text-xs text-star">{e.text}</p>
            <p className="text-[11px] text-dim">
              {new Date(e.at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}{" "}
              ·{" "}
              {new Date(e.at).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
