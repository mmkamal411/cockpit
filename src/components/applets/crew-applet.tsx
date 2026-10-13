"use client";

import { useEffect, useState } from "react";

const SYNC_OPTIONS = ["Grades", "Attendance", "Assignments", "School messages"];

type Step = 1 | 2 | 3;

interface CrewMemberRow {
  id: string;
  name: string;
  birthdate: string | null;
  relationship: string;
  created_at: string;
  school_sync?: {
    sync_status: string;
    last_synced_at: string | null;
  };
}

interface ClassRow {
  id: string;
  name: string;
  grade: number | null;
  letter: string | null;
  gap_to_90: number | null;
}

/** True when a member's school connection needs the parent's attention. */
function needsAttention(m: CrewMemberRow): boolean {
  const s = m.school_sync;
  if (!s) return false;
  if (s.sync_status === "error" || s.sync_status === "auth_error") return true;
  if (!s.last_synced_at) return false; // never synced but no error — not alarming
  const ageMs = Date.now() - new Date(s.last_synced_at).getTime();
  return ageMs > 24 * 60 * 60 * 1000;
}

/** Plain-English sync status for the roster. */
function syncStatusText(m: CrewMemberRow): { text: string; tone: "ok" | "warn" | "idle" } {
  const s = m.school_sync;
  if (!s || !s.last_synced_at) {
    return { text: "Not connected yet", tone: "idle" };
  }
  const ageMs = Date.now() - new Date(s.last_synced_at).getTime();
  const mins = Math.round(ageMs / 60000);
  const rel =
    mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} hr ago` : `${Math.round(mins / 1440)} days ago`;
  if (s.sync_status === "auth_error") {
    return { text: "School login needs updating", tone: "warn" };
  }
  if (s.sync_status === "error" || ageMs > 24 * 60 * 60 * 1000) {
    return { text: `Last synced ${rel} — might need attention`, tone: "warn" };
  }
  return { text: `Last synced ${rel}`, tone: "ok" };
}

/**
 * Crew — the opt-in family module. Adding a child is entirely optional and
 * lives here, never in onboarding. Three steps: who they are, their school
 * login, what to keep in sync. Crew members are stored in Supabase
 * (crew_members table), keyed by UUID — never by name.
 */
export function CrewApplet() {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [district, setDistrict] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sync, setSync] = useState<string[]>(["Grades", "Assignments"]);
  const [added, setAdded] = useState<CrewMemberRow | null>(null);
  const [roster, setRoster] = useState<CrewMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  // Member detail view: when set, shows the member's profile instead of the roster/form.
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  // Re-auth form state (per crew member).
  const [reauthFor, setReauthFor] = useState<string | null>(null);
  const [reauthUsername, setReauthUsername] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [reauthSaving, setReauthSaving] = useState(false);
  const [reauthMessage, setReauthMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Classes/grades for the detail view.
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [classesSyncedAt, setClassesSyncedAt] = useState<string | null>(null);
  const [classesMessage, setClassesMessage] = useState("");

  // Load the pilot's crew roster on mount.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/crew/members");
        if (res.status === 401) {
          // Not signed in — the applet shell handles the sign-in prompt.
          if (!cancelled) setLoading(false);
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "load failed");
        if (!cancelled) setRoster(json.members ?? []);
      } catch {
        if (!cancelled)
          setLoadError("Couldn't load your crew right now. Try reopening this panel.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleSync(option: string) {
    setSync((prev) =>
      prev.includes(option) ? prev.filter((s) => s !== option) : [...prev, option],
    );
  }

  function nextFromBasics() {
    if (!name.trim()) {
      setError("Give your crew member a name so Crystal knows who they are.");
      return;
    }
    if (!birthdate) {
      setError("Add a birthdate — it helps Crystal get the details right.");
      return;
    }
    setError("");
    setStep(2);
  }

  function nextFromSchool() {
    // School login is optional — the desktop sync installer handles
    // credentials later. Advance to step 3 regardless of field state.
    setError("");
    setStep(3);
  }

  async function finish() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/crew/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), birthdate, relationship: "child" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "save failed");
      const member: CrewMemberRow = json.member;
      setRoster((prev) => [...prev, member]);
      setAdded(member);
      // NOTE: school credentials (district/username/password) are NOT sent
      // to the server here. The desktop sync installer handles credential
      // capture into the OS keychain. This flow records the roster only.
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't add them right now. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setAdded(null);
    setStep(1);
    setName("");
    setBirthdate("");
    setDistrict("");
    setUsername("");
    setPassword("");
    setSync(["Grades", "Assignments"]);
    setError("");
    closeReauth();
  }

  function openReauth(memberId: string) {
    setReauthFor(memberId);
    setReauthUsername("");
    setReauthPassword("");
    setReauthMessage(null);
  }

  function closeReauth() {
    setReauthFor(null);
    setReauthUsername("");
    setReauthPassword("");
    setReauthMessage(null);
  }

  /** Open a member's detail view and load their classes. */
  function openMemberDetail(memberId: string) {
    setSelectedMemberId(memberId);
    setClasses([]);
    setClassesMessage("");
    setClassesSyncedAt(null);
    closeReauth();
    loadMemberClasses(memberId);
  }

  function closeMemberDetail() {
    setSelectedMemberId(null);
    setClasses([]);
    setClassesMessage("");
    setClassesSyncedAt(null);
    closeReauth();
  }

  async function loadMemberClasses(memberId: string) {
    setClassesLoading(true);
    try {
      const res = await fetch(`/api/crew/members/${memberId}/classes`);
      const json = await res.json();
      if (res.ok) {
        setClasses(json.classes ?? []);
        setClassesSyncedAt(json.synced_at ?? null);
        if (json.message) setClassesMessage(json.message);
      } else {
        setClassesMessage("Couldn't load classes right now.");
      }
    } catch {
      setClassesMessage("Couldn't load classes right now.");
    } finally {
      setClassesLoading(false);
    }
  }

  async function submitReauth(memberId: string) {
    if (!reauthUsername.trim() || !reauthPassword) {
      setReauthMessage({
        ok: false,
        text: "Enter both the username and password for the school portal.",
      });
      return;
    }
    setReauthSaving(true);
    setReauthMessage(null);
    try {
      const res = await fetch(`/api/crew/members/${memberId}/school-reauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: reauthUsername.trim(),
          password: reauthPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setReauthMessage({
          ok: false,
          text: json.error ?? "That didn't work. Try again.",
        });
        return;
      }
      setReauthMessage({ ok: true, text: json.message });
      // Clear the password from memory immediately.
      setReauthPassword("");
      // Refresh the roster so the status indicator updates.
      const rosterRes = await fetch("/api/crew/members");
      if (rosterRes.ok) {
        const rosterJson = await rosterRes.json();
        setRoster(rosterJson.members ?? []);
        const updated = (rosterJson.members ?? []).find(
          (m: CrewMemberRow) => m.id === memberId,
        );
        if (updated) setAdded((prev) => (prev && prev.id === memberId ? updated : prev));
      }
    } catch {
      setReauthMessage({
        ok: false,
        text: "We couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      setReauthSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
          Crew
        </p>
        <p className="text-sm text-stardust">Loading your crew…</p>
      </div>
    );
  }

  // Member detail view — opened by tapping a crew member's name in any roster.
  if (selectedMemberId) {
    const member = roster.find((m) => m.id === selectedMemberId);
    if (!member) {
      // Member vanished from roster (e.g. removed) — back to the list.
      setSelectedMemberId(null);
      return null;
    }
    const status = syncStatusText(member);
    const attention = needsAttention(member);
    const dotColor =
      status.tone === "ok"
        ? "bg-neon-green"
        : status.tone === "warn"
          ? "bg-neon-amber"
          : "bg-dim";
    return (
      <div className="space-y-5">
        <div>
          <button
            type="button"
            onClick={closeMemberDetail}
            className="mb-3 flex items-center gap-1.5 text-sm text-stardust transition-colors hover:text-star"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to crew
          </button>
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
            Crew · {member.relationship}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-star">{member.name}</h2>
          {member.birthdate && (
            <p className="mt-1 text-sm text-dim">
              Born {new Date(member.birthdate + "T00:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            </p>
          )}
        </div>

        {/* School sync status */}
        <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotColor}`} />
              <div>
                <p className="text-sm font-medium text-star">School sync</p>
                <p className={`text-xs ${status.tone === "warn" ? "text-neon-amber" : "text-dim"}`}>
                  {status.text}
                </p>
              </div>
            </div>
            {attention && reauthFor !== member.id && (
              <button
                type="button"
                onClick={() => openReauth(member.id)}
                className="rounded-lg border border-neon-amber/40 bg-neon-amber/10 px-3 py-1.5 text-xs font-medium text-neon-amber transition-colors hover:bg-neon-amber/20"
              >
                Update login
              </button>
            )}
          </div>
          {reauthFor === member.id && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-sm font-medium text-star">
                Update {member.name}&apos;s school login
              </p>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                We&apos;ll test it against the school portal right now.
                It&apos;s only used for that check — never stored as plain text.
              </p>
              <div className="mt-3 space-y-2.5">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-stardust">
                    School portal username
                  </span>
                  <input
                    value={reauthUsername}
                    onChange={(e) => setReauthUsername(e.target.value)}
                    placeholder="Student username or ID"
                    autoComplete="off"
                    disabled={reauthSaving}
                    className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-stardust">
                    School portal password
                  </span>
                  <input
                    type="password"
                    value={reauthPassword}
                    onChange={(e) => setReauthPassword(e.target.value)}
                    placeholder="Portal password"
                    autoComplete="new-password"
                    disabled={reauthSaving}
                    className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                  />
                </label>
              </div>
              {reauthMessage && (
                <p
                  role="alert"
                  className={`mt-2.5 rounded-xl border px-4 py-2.5 text-sm ${
                    reauthMessage.ok
                      ? "border-neon-green/30 bg-neon-green/5 text-neon-green"
                      : "border-neon-amber/30 bg-neon-amber/5 text-neon-amber"
                  }`}
                >
                  {reauthMessage.text}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={closeReauth}
                  disabled={reauthSaving}
                  className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => submitReauth(member.id)}
                  disabled={reauthSaving}
                  className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
                >
                  {reauthSaving ? "Checking…" : "Check this login"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Classes & grades */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
            Classes
          </p>
          {classesLoading ? (
            <p className="text-sm text-stardust">Loading classes…</p>
          ) : classes.length > 0 ? (
            <div className="space-y-2">
              {classesSyncedAt && (
                <p className="text-xs text-dim">
                  Synced {new Date(classesSyncedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {" at "}
                  {new Date(classesSyncedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </p>
              )}
              {classes.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-line bg-panel-2/60 px-4 py-2.5"
                >
                  <span className="text-sm text-star">{c.name}</span>
                  <span className="flex items-center gap-2">
                    {c.gap_to_90 !== null && c.gap_to_90 > 0 && (
                      <span className="text-xs text-neon-amber">{c.gap_to_90.toFixed(1)} to 90</span>
                    )}
                    <span className={`text-sm font-semibold ${
                      c.grade === null ? "text-dim"
                      : c.grade >= 90 ? "text-neon-green"
                      : c.grade >= 80 ? "text-star"
                      : c.grade >= 74 ? "text-neon-amber"
                      : "text-red-400"
                    }`}>
                      {c.grade !== null ? `${c.grade.toFixed(1)}` : "—"}
                      {c.letter && <span className="ml-1 text-xs font-normal text-dim">{c.letter}</span>}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
              {classesMessage || "No school data yet — connect a school login to see classes and grades."}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (added) {
    return (
      <div className="space-y-5 text-center">
        <p aria-hidden="true" className="text-4xl">
          🛸
        </p>
        <div>
          <h2 className="text-xl font-semibold text-star">{added.name} is aboard</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-stardust">
            {added.name}&apos;s crew profile is saved to your cockpit. School sync
            will pick up{" "}
            {sync.length > 0 ? sync.join(", ").toLowerCase() : "nothing yet"}
            {district ? ` from ${district}` : ""} once the school connection is
            switched on.
          </p>
        </div>
        {roster.length > 0 && (
          <div className="mx-auto max-w-sm space-y-2 text-left">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
              Your crew
            </p>
            {roster.map((m) => {
              const status = syncStatusText(m);
              const attention = needsAttention(m);
              const dotColor =
                status.tone === "ok"
                  ? "bg-neon-green"
                  : status.tone === "warn"
                    ? "bg-neon-amber"
                    : "bg-dim";
              return (
                <div key={m.id} className="space-y-2">
                  <div className="flex items-center justify-between rounded-xl border border-line bg-panel-2/60 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => openMemberDetail(m.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-opacity hover:opacity-80"
                      aria-label={`View ${m.name}'s profile`}
                    >
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-star underline decoration-dotted decoration-dim/50 underline-offset-2">{m.name}</div>
                        <div
                          className={`truncate text-xs ${status.tone === "warn" ? "text-neon-amber" : "text-dim"}`}
                        >
                          {status.text}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-dim">{m.relationship}</span>
                      {attention && reauthFor !== m.id && (
                        <button
                          type="button"
                          onClick={() => openReauth(m.id)}
                          className="rounded-lg border border-neon-amber/40 bg-neon-amber/10 px-3 py-1.5 text-xs font-medium text-neon-amber transition-colors hover:bg-neon-amber/20"
                        >
                          Update login
                        </button>
                      )}
                    </div>
                  </div>
                  {reauthFor === m.id && (
                    <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
                      <p className="text-sm font-medium text-star">
                        Update {m.name}&apos;s school login
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-dim">
                        We&apos;ll test it against the school portal right now.
                        It&apos;s only used for that check — never stored as
                        plain text.
                      </p>
                      <div className="mt-3 space-y-2.5">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-stardust">
                            School portal username
                          </span>
                          <input
                            value={reauthUsername}
                            onChange={(e) => setReauthUsername(e.target.value)}
                            placeholder="Student username or ID"
                            autoComplete="off"
                            disabled={reauthSaving}
                            className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-stardust">
                            School portal password
                          </span>
                          <input
                            type="password"
                            value={reauthPassword}
                            onChange={(e) => setReauthPassword(e.target.value)}
                            placeholder="Portal password"
                            autoComplete="new-password"
                            disabled={reauthSaving}
                            className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                          />
                        </label>
                      </div>
                      {reauthMessage && (
                        <p
                          role="alert"
                          className={`mt-2.5 rounded-xl border px-4 py-2.5 text-sm ${
                            reauthMessage.ok
                              ? "border-neon-green/30 bg-neon-green/5 text-neon-green"
                              : "border-neon-amber/30 bg-neon-amber/5 text-neon-amber"
                          }`}
                        >
                          {reauthMessage.text}
                        </p>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={closeReauth}
                          disabled={reauthSaving}
                          className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => submitReauth(m.id)}
                          disabled={reauthSaving}
                          className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
                        >
                          {reauthSaving ? "Checking…" : "Check this login"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={resetForm}
          className="rounded-xl border border-neon-green/40 bg-neon-green/10 px-5 py-2.5 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
        >
          Add another crew member
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
          Crew · step {step} of 3
        </p>
        <h2 className="mt-1 text-xl font-semibold text-star">
          {step === 1
            ? "Who's joining your crew?"
            : step === 2
              ? "School login"
              : "What should Crystal watch?"}
        </h2>
        <p className="mt-1 text-sm text-stardust">
          {step === 1 && "Just the basics — Crystal handles the rest."}
          {step === 2 && "Their school portal login, so grades and assignments can sync."}
          {step === 3 && "Pick what Crystal keeps an eye on for them."}
        </p>
      </div>

      {loadError && (
        <p
          role="alert"
          className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-sm text-neon-amber"
        >
          {loadError}
        </p>
      )}

      {roster.length > 0 && step === 1 && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
            Already aboard — tap a name to view their profile
          </p>
          {roster.map((m) => {
            const status = syncStatusText(m);
            const dotColor =
              status.tone === "ok"
                ? "bg-neon-green"
                : status.tone === "warn"
                  ? "bg-neon-amber"
                  : "bg-dim";
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => openMemberDetail(m.id)}
                className="flex w-full items-center justify-between rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-left transition-colors hover:border-neon-green/30"
                aria-label={`View ${m.name}'s profile`}
              >
                <span className="flex items-center gap-2.5">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotColor}`} />
                  <span className="text-sm text-star underline decoration-dotted decoration-dim/50 underline-offset-2">{m.name}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`text-xs ${status.tone === "warn" ? "text-neon-amber" : "text-dim"}`}>
                    {status.tone !== "idle" ? status.text : m.relationship}
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-dim">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-sm text-neon-amber"
        >
          {error}
        </p>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Their first name"
              autoComplete="off"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">Birthdate</span>
            <input
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star focus:border-neon-green/60 focus:outline-none"
            />
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">
              School district
            </span>
            <input
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              placeholder="e.g. Cobb County School District"
              autoComplete="off"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">
              Student portal username
            </span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Student username or ID"
              autoComplete="off"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">
              Student portal password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Portal password"
              autoComplete="new-password"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
            />
          </label>
          <p className="text-xs leading-relaxed text-dim">
            Use the desktop sync installer to connect school logins securely —
            passwords stay in your computer&apos;s keychain and never reach our
            servers. You can also skip this and connect later.
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-2">
          {SYNC_OPTIONS.map((option) => {
            const on = sync.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => toggleSync(option)}
                aria-pressed={on}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                  on
                    ? "border-neon-green/40 bg-neon-green/10 text-star"
                    : "border-line bg-panel-2/60 text-stardust hover:border-neon-green/25"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                    on
                      ? "border-neon-green bg-neon-green/25 text-neon-green"
                      : "border-dim/60 text-transparent"
                  }`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 12.5l5 5L20 6.5" />
                  </svg>
                </span>
                {option}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {step > 1 && (
          <button
            type="button"
            onClick={() => {
              setError("");
              setStep((s) => (s - 1) as Step);
            }}
            disabled={saving}
            className="rounded-xl border border-line bg-panel-2/60 px-5 py-2.5 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
          >
            Back
          </button>
        )}
        {step === 1 ? (
          <button
            type="button"
            onClick={nextFromBasics}
            className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 px-5 py-2.5 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Continue
          </button>
        ) : step === 2 ? (
          <button
            type="button"
            onClick={nextFromSchool}
            className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 px-5 py-2.5 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            onClick={finish}
            disabled={saving}
            className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 px-5 py-2.5 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
          >
            {saving ? "Bringing them aboard…" : "Bring them aboard"}
          </button>
        )}
      </div>
    </div>
  );
}
