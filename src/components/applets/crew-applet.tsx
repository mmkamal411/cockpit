"use client";

import { useEffect, useState } from "react";

import { ClassDetail } from "./class-detail";

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

interface GpaInfo {
  weighted_gpa?: number | null;
  unweighted_gpa?: number | null;
  cumulative_gpa?: number | null;
}

interface AttendanceInfo {
  absences?: number | null;
  tardies?: number | null;
}

interface SchoolMessage {
  source: "synergy" | "outlook";
  sender: string | null;
  subject: string | null;
  preview: string | null;
  date: string | null;
}

interface BellScheduleEntry {
  label: string;
  url: string;
}

interface SchoolSourceSnapshot {
  url: string;
  fetched_at: string | null;
  status: string | null;
  error_note: string | null;
}

interface BellSourceSnapshot extends SchoolSourceSnapshot {
  label: string;
}

interface SchoolSources {
  district: string | null;
  calendar_source_url: string | null;
  bell_schedules: BellScheduleEntry[];
  last_checked_at: string | null;
  check_status: string | null;
  check_note: string | null;
}

/** Scoped dark-theme styles for sanitized district calendar / bell-schedule HTML. */
const SCHOOL_SOURCE_STYLES = `
.school-source-content { color: #eef6fa; font-size: 0.875rem; line-height: 1.55; overflow-wrap: anywhere; }
.school-source-content h1, .school-source-content h2, .school-source-content h3, .school-source-content h4 { color: #eef6fa; font-weight: 600; margin: 0.75rem 0 0.25rem; }
.school-source-content p, .school-source-content ul, .school-source-content ol { margin: 0.5rem 0; }
.school-source-content ul, .school-source-content ol { padding-left: 1.25rem; }
.school-source-content table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
.school-source-content th, .school-source-content td { padding: 0.45rem 0.65rem; border: 1px solid rgb(255 255 255 / 0.1); color: #eef6fa; text-align: left; vertical-align: top; }
.school-source-content th { font-weight: 600; background: rgb(255 255 255 / 0.05); }
.school-source-content a { color: #86efac; text-decoration: underline; }
.school-source-content img { max-width: 100%; height: auto; }
`;

/** "3 hr ago" style relative time for source check stamps. */
function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  if (ms < 60000) return "just now";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

/** Hostname for "Source: example.com" attribution lines. */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Pick the most meaningful GPA the sync carried, with its label. */
function pickGpa(gpa: GpaInfo | null): { value: number; label: string } | null {
  if (!gpa) return null;
  if (typeof gpa.unweighted_gpa === "number" && Number.isFinite(gpa.unweighted_gpa))
    return { value: gpa.unweighted_gpa, label: "unweighted" };
  if (typeof gpa.weighted_gpa === "number" && Number.isFinite(gpa.weighted_gpa))
    return { value: gpa.weighted_gpa, label: "weighted" };
  if (typeof gpa.cumulative_gpa === "number" && Number.isFinite(gpa.cumulative_gpa))
    return { value: gpa.cumulative_gpa, label: "cumulative" };
  return null;
}

/** Plain-English attendance summary from the sync's attendance object. */
function attendanceText(a: AttendanceInfo): string {
  const abs = typeof a.absences === "number" ? a.absences : null;
  const tar = typeof a.tardies === "number" ? a.tardies : null;
  if (abs === null && tar === null)
    return "Attendance was synced, but no absence or tardy counts were included.";
  const parts: string[] = [];
  if (abs !== null) parts.push(`${abs} ${abs === 1 ? "absence" : "absences"}`);
  if (tar !== null) parts.push(`${tar} ${tar === 1 ? "tardy" : "tardies"}`);
  if (abs === 0 && tar === 0) return "No absences or tardies — a clean record.";
  return parts.join(" · ");
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
  // Optional school calendar + bell schedule captured in step 2.
  const [newCalendarUrl, setNewCalendarUrl] = useState("");
  const [newBellLabel, setNewBellLabel] = useState("Daily");
  const [newBellUrl, setNewBellUrl] = useState("");
  const [sourcesNote, setSourcesNote] = useState("");
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
  // First-time connect form state (per crew member) — two separate logins:
  // ParentVUE (parent portal, server-side pulls) and student (laptop workers).
  const [connectFor, setConnectFor] = useState<string | null>(null);
  const [parentUsername, setParentUsername] = useState("");
  const [parentPassword, setParentPassword] = useState("");
  const [parentSaving, setParentSaving] = useState(false);
  const [parentMessage, setParentMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [studentUsername, setStudentUsername] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [studentSaving, setStudentSaving] = useState(false);
  const [studentMessage, setStudentMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Classes/grades for the detail view.
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(false);
  const [classesSyncedAt, setClassesSyncedAt] = useState<string | null>(null);
  const [classesMessage, setClassesMessage] = useState("");
  // Grade freshness from the same sync row.
  const [classesStale, setClassesStale] = useState(false);
  const [classesHours, setClassesHours] = useState<number | null>(null);
  // Extended school overview from the same sync row: GPA, attendance, messages.
  const [gpa, setGpa] = useState<GpaInfo | null>(null);
  const [attendance, setAttendance] = useState<AttendanceInfo | null>(null);
  const [messages, setMessages] = useState<SchoolMessage[]>([]);
  // Sync-now status.
  const [syncNowBusy, setSyncNowBusy] = useState(false);
  const [syncNowMessage, setSyncNowMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Link code (same-room family sharing): one live code at a time.
  const [linkCodeFor, setLinkCodeFor] = useState<string | null>(null);
  const [linkCodeBusy, setLinkCodeBusy] = useState(false);
  const [linkCode, setLinkCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [linkCodeError, setLinkCodeError] = useState("");
  // Remove member: two-tap confirm, never one stray tap.
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  // Class detail drill-down: when set, shows one class's full page.
  const [selectedClassName, setSelectedClassName] = useState<string | null>(null);
  // School calendar + bell schedules (member detail view).
  const [srcLoading, setSrcLoading] = useState(false);
  const [srcSources, setSrcSources] = useState<SchoolSources | null>(null);
  const [srcSnapshots, setSrcSnapshots] = useState<{
    calendar: SchoolSourceSnapshot | null;
    bells: BellSourceSnapshot[];
  }>({ calendar: null, bells: [] });
  const [srcEditing, setSrcEditing] = useState(false);
  const [srcDistrict, setSrcDistrict] = useState("");
  const [srcCalendarUrl, setSrcCalendarUrl] = useState("");
  const [srcBells, setSrcBells] = useState<BellScheduleEntry[]>([]);
  const [srcSaving, setSrcSaving] = useState(false);
  const [srcRefreshing, setSrcRefreshing] = useState(false);
  const [srcMessage, setSrcMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [calHtml, setCalHtml] = useState<string | null>(null);
  const [calUrl, setCalUrl] = useState("");
  const [calFetchedAt, setCalFetchedAt] = useState<string | null>(null);
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState("");
  const [bellsOpen, setBellsOpen] = useState(false);
  const [bellTab, setBellTab] = useState(0);
  const [bellHtml, setBellHtml] = useState<Record<number, string>>({});
  const [bellMeta, setBellMeta] = useState<
    Record<number, { url: string; fetchedAt: string | null }>
  >({});
  const [bellLoading, setBellLoading] = useState(false);
  const [bellError, setBellError] = useState("");

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

  // Load school calendar + bell schedule sources whenever a member's detail opens.
  useEffect(() => {
    if (!selectedMemberId) return;
    resetSchoolSources();
    loadSchoolSources(selectedMemberId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMemberId]);

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
      setSourcesNote("");
      // Optional calendar/bell links captured in step 2 — saved against the
      // new member. A failure here never blocks the add; the parent can add
      // the links later from the member's profile.
      const calLink = newCalendarUrl.trim();
      const bellLink = newBellUrl.trim();
      if (calLink || bellLink) {
        const bellSchedules = bellLink
          ? [{ label: newBellLabel.trim() || "Daily", url: bellLink }]
          : [];
        try {
          await fetch(`/api/crew/members/${member.id}/school-sources`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              district: district.trim() || null,
              calendar_source_url: calLink || null,
              bell_schedules: bellSchedules,
            }),
          });
        } catch {
          setSourcesNote(
            "Their profile is saved, but the calendar links didn't save. You can add them from their profile.",
          );
        }
      }
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
    setNewCalendarUrl("");
    setNewBellLabel("Daily");
    setNewBellUrl("");
    setSourcesNote("");
    setError("");
    closeReauth();
    closeConnect();
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

  /** Open the first-time connect form (two logins: ParentVUE + student). */
  function openConnect(memberId: string) {
    setConnectFor(memberId);
    setParentUsername("");
    setParentPassword("");
    setParentMessage(null);
    setStudentUsername("");
    setStudentPassword("");
    setStudentMessage(null);
  }

  function closeConnect() {
    setConnectFor(null);
    setParentUsername("");
    setParentPassword("");
    setParentMessage(null);
    setStudentUsername("");
    setStudentPassword("");
    setStudentMessage(null);
  }

  /** Refresh the roster after a credential save so status indicators update. */
  async function refreshRoster() {
    const rosterRes = await fetch("/api/crew/members");
    if (rosterRes.ok) {
      const rosterJson = await rosterRes.json();
      setRoster(rosterJson.members ?? []);
    }
  }

  /** Test + save the ParentVUE (parent portal) login. */
  async function submitParentLogin(memberId: string) {
    if (!parentUsername.trim() || !parentPassword) {
      setParentMessage({
        ok: false,
        text: "Enter both the ParentVUE username and password.",
      });
      return;
    }
    setParentSaving(true);
    setParentMessage(null);
    try {
      const res = await fetch(`/api/crew/members/${memberId}/school-reauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: parentUsername.trim(),
          password: parentPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setParentMessage({ ok: false, text: json.error ?? "That didn't work. Try again." });
        return;
      }
      setParentMessage({ ok: true, text: json.message });
      setParentPassword("");
      await refreshRoster();
    } catch {
      setParentMessage({
        ok: false,
        text: "We couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      setParentSaving(false);
    }
  }

  /** Test + save the student (StudentVUE / Outlook / CTLS) login. */
  async function submitStudentLogin(memberId: string) {
    if (!studentUsername.trim() || !studentPassword) {
      setStudentMessage({
        ok: false,
        text: "Enter both the student's school email and password.",
      });
      return;
    }
    setStudentSaving(true);
    setStudentMessage(null);
    try {
      const res = await fetch(`/api/crew/members/${memberId}/student-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: studentUsername.trim(),
          password: studentPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStudentMessage({ ok: false, text: json.error ?? "That didn't work. Try again." });
        return;
      }
      setStudentMessage({ ok: true, text: json.message });
      setStudentPassword("");
      await refreshRoster();
    } catch {
      setStudentMessage({
        ok: false,
        text: "We couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      setStudentSaving(false);
    }
  }

  /** Open a member's detail view and load their classes. */
  function openMemberDetail(memberId: string) {
    setSelectedMemberId(memberId);
    setSelectedClassName(null);
    setClasses([]);
    setClassesMessage("");
    setClassesSyncedAt(null);
    setGpa(null);
    setAttendance(null);
    setMessages([]);
    setSyncNowMessage(null);
    setLinkCodeFor(null);
    setLinkCode(null);
    setLinkCodeError("");
    setConfirmRemove(false);
    setRemoveError("");
    closeReauth();
    closeConnect();
    loadMemberClasses(memberId);
  }

  function closeMemberDetail() {
    setSelectedMemberId(null);
    setClasses([]);
    setClassesMessage("");
    setClassesSyncedAt(null);
    setGpa(null);
    setAttendance(null);
    setMessages([]);
    setSyncNowMessage(null);
    setLinkCodeFor(null);
    setLinkCode(null);
    setLinkCodeError("");
    setConfirmRemove(false);
    setRemoveError("");
    closeReauth();
    closeConnect();
  }

  async function loadMemberClasses(memberId: string) {
    setClassesLoading(true);
    try {
      const res = await fetch(`/api/crew/members/${memberId}/classes`);
      const json = await res.json();
      if (res.ok) {
        setClasses(json.classes ?? []);
        setClassesSyncedAt(json.synced_at ?? null);
        setGpa(json.gpa ?? null);
        setAttendance(json.attendance ?? null);
        setMessages(Array.isArray(json.messages) ? json.messages : []);
        setClassesStale(!!json.stale);
        setClassesHours(json.hours_since_sync ?? null);
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

  // ----- School calendar & bell schedules -----

  function resetSchoolSources() {
    setSrcLoading(false);
    setSrcSources(null);
    setSrcSnapshots({ calendar: null, bells: [] });
    setSrcEditing(false);
    setSrcDistrict("");
    setSrcCalendarUrl("");
    setSrcBells([]);
    setSrcSaving(false);
    setSrcRefreshing(false);
    setSrcMessage(null);
    setCalHtml(null);
    setCalUrl("");
    setCalFetchedAt(null);
    setCalLoading(false);
    setCalError("");
    setBellsOpen(false);
    setBellTab(0);
    setBellHtml({});
    setBellMeta({});
    setBellLoading(false);
    setBellError("");
  }

  /** Fetch saved sources + snapshots; pulls calendar content when a URL is saved. */
  async function loadSchoolSources(memberId: string) {
    setSrcLoading(true);
    setCalHtml(null);
    setCalUrl("");
    setCalFetchedAt(null);
    setCalError("");
    setBellHtml({});
    setBellMeta({});
    setBellError("");
    setBellTab(0);
    try {
      const res = await fetch(`/api/crew/members/${memberId}/school-sources`);
      const json = await res.json();
      let sources: SchoolSources | null = null;
      if (res.ok) {
        sources = json.sources
          ? {
              district: json.sources.district ?? null,
              calendar_source_url: json.sources.calendar_source_url ?? null,
              bell_schedules: Array.isArray(json.sources.bell_schedules)
                ? json.sources.bell_schedules
                : [],
              last_checked_at: json.sources.last_checked_at ?? null,
              check_status: json.sources.check_status ?? null,
              check_note: json.sources.check_note ?? null,
            }
          : null;
        setSrcSources(sources);
        setSrcSnapshots({
          calendar: json.snapshots?.calendar ?? null,
          bells: Array.isArray(json.snapshots?.bells) ? json.snapshots.bells : [],
        });
        if (sources?.calendar_source_url) await loadCalendarContent(memberId);
      } else {
        setSrcMessage({
          ok: false,
          text: json.error ?? "Couldn't load the school calendar settings.",
        });
      }
    } catch {
      setSrcMessage({
        ok: false,
        text: "We couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      setSrcLoading(false);
    }
  }

  async function loadCalendarContent(memberId: string) {
    setCalLoading(true);
    setCalError("");
    try {
      const res = await fetch(
        `/api/crew/members/${memberId}/school-sources/content?kind=calendar`,
      );
      const json = await res.json();
      if (json.ok) {
        setCalHtml(json.html ?? "");
        setCalUrl(json.url ?? "");
        setCalFetchedAt(json.fetched_at ?? null);
      } else {
        setCalError(json.error ?? "The calendar page didn't load.");
      }
    } catch {
      setCalError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setCalLoading(false);
    }
  }

  /** Fetch one bell schedule's snapshot HTML, cached per tab index. */
  async function ensureBellContent(memberId: string, index: number, force = false) {
    if (!force && (bellHtml[index] !== undefined || bellLoading || bellError)) return;
    setBellLoading(true);
    setBellError("");
    try {
      const res = await fetch(
        `/api/crew/members/${memberId}/school-sources/content?kind=bell&index=${index}`,
      );
      const json = await res.json();
      if (json.ok) {
        setBellHtml((prev) => ({ ...prev, [index]: json.html ?? "" }));
        setBellMeta((prev) => ({
          ...prev,
          [index]: { url: json.url ?? "", fetchedAt: json.fetched_at ?? null },
        }));
      } else {
        setBellError(json.error ?? "That bell schedule didn't load.");
      }
    } catch {
      setBellError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBellLoading(false);
    }
  }

  /** Prefill the editor from the saved sources and open it. */
  function openSourcesEditor() {
    setSrcDistrict(srcSources?.district ?? "");
    setSrcCalendarUrl(srcSources?.calendar_source_url ?? "");
    const bells = (srcSources?.bell_schedules ?? []).map((b) => ({
      label: b.label,
      url: b.url,
    }));
    setSrcBells(bells.length > 0 ? bells : [{ label: "Daily", url: "" }]);
    setSrcMessage(null);
    setSrcEditing(true);
  }

  function addBellRow() {
    setSrcBells((prev) =>
      prev.length >= 5 ? prev : [...prev, { label: "", url: "" }],
    );
  }

  function removeBellRow(i: number) {
    setSrcBells((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateBellRow(i: number, field: "label" | "url", value: string) {
    setSrcBells((prev) =>
      prev.map((b, idx) => (idx === i ? { ...b, [field]: value } : b)),
    );
  }

  /** Save the sources form, then re-pull sources + content. */
  async function saveSchoolSources(memberId: string) {
    setSrcSaving(true);
    setSrcMessage(null);
    try {
      const bells = srcBells
        .map((b) => ({ label: b.label.trim() || "Schedule", url: b.url.trim() }))
        .filter((b) => b.url);
      const res = await fetch(`/api/crew/members/${memberId}/school-sources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          district: srcDistrict.trim() || null,
          calendar_source_url: srcCalendarUrl.trim() || null,
          bell_schedules: bells,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "save failed");
      setSrcMessage({ ok: true, text: "Saved — pulling the latest pages now." });
      setSrcEditing(false);
      await loadSchoolSources(memberId);
      if (bellsOpen) await ensureBellContent(memberId, 0, true);
    } catch (e) {
      setSrcMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Couldn't save those links. Try again.",
      });
    } finally {
      setSrcSaving(false);
    }
  }

  /** Re-check the saved pages now, then reload sources + content. */
  async function refreshSchoolSources(memberId: string) {
    setSrcRefreshing(true);
    setSrcMessage(null);
    try {
      const res = await fetch(
        `/api/crew/members/${memberId}/school-sources/refresh`,
        { method: "POST" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "refresh failed");
      const results: { label: string; status: string; error_note?: string }[] =
        json.results ?? [];
      const failed = results.filter((r) => r.status !== "ok");
      setSrcMessage({
        ok: failed.length === 0,
        text:
          failed.length === 0
            ? `Checked ${results.length} ${results.length === 1 ? "page" : "pages"} — all fresh.`
            : `${failed.length} of ${results.length} didn't load: ${failed
                .map((f) => `${f.label} — ${f.error_note ?? "try again"}`)
                .join("; ")}`,
      });
      await loadSchoolSources(memberId);
      if (bellsOpen) {
        setBellError("");
        await ensureBellContent(memberId, bellTab, true);
      }
    } catch (e) {
      setSrcMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Couldn't refresh right now. Try again.",
      });
    } finally {
      setSrcRefreshing(false);
    }
  }

  /** SYNC NOW — ask the server for fresh school data, show the honest status. */
  async function syncNow(memberId: string) {
    setSyncNowBusy(true);
    setSyncNowMessage(null);
    try {
      const res = await fetch(`/api/crew/members/${memberId}/sync`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.ok) {
        setSyncNowMessage({ ok: true, text: json.message ?? "School data is fresh." });
        await refreshRoster();
        await loadMemberClasses(memberId);
      } else {
        setSyncNowMessage({
          ok: false,
          text: json.error ?? "Couldn't check for fresh data right now.",
        });
      }
    } catch {
      setSyncNowMessage({
        ok: false,
        text: "We couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      setSyncNowBusy(false);
    }
  }

  /** Mint a same-room link code for this crew member. */
  async function mintLinkCode(memberId: string) {
    setLinkCodeBusy(true);
    setLinkCodeError("");
    setLinkCode(null);
    try {
      const res = await fetch(`/api/crew/members/${memberId}/link-code`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.ok) {
        setLinkCode({ code: json.code, expires_at: json.expires_at });
      } else {
        setLinkCodeError(json.error ?? "Couldn't create a code right now.");
      }
    } catch {
      setLinkCodeError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setLinkCodeBusy(false);
    }
  }

  /** Remove a crew member (two-tap confirm). Cascades to their school data. */
  async function removeMember(memberId: string) {
    setRemoving(true);
    setRemoveError("");
    try {
      const res = await fetch(`/api/crew/members/${memberId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setRemoveError(json.error ?? "Couldn't remove them right now.");
        return;
      }
      setRoster((prev) => prev.filter((m) => m.id !== memberId));
      closeMemberDetail();
    } catch {
      setRemoveError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setRemoving(false);
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
    // Class detail drill-down — one class's full page.
    if (selectedClassName) {
      return (
        <ClassDetail
          memberId={selectedMemberId}
          className={selectedClassName}
          onBack={() => setSelectedClassName(null)}
        />
      );
    }
    const status = syncStatusText(member);
    const attention = needsAttention(member);
    const gpaPick = pickGpa(gpa);
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
          <button
            onClick={() => navigator.clipboard?.writeText(member.id).catch(() => {})}
            title="Copy crew member ID"
            className="mt-1 font-mono text-[10px] text-dim/60 hover:text-dim active:text-star"
          >
            ID: {member.id.slice(0, 8)}… tap to copy
          </button>
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
            {!attention && status.tone === "idle" && connectFor !== member.id && (
              <button
                type="button"
                onClick={() => openConnect(member.id)}
                className="rounded-lg border border-neon-green/40 bg-neon-green/10 px-3 py-1.5 text-xs font-medium text-neon-green transition-colors hover:bg-neon-green/20"
              >
                Connect school login
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
          {connectFor === member.id && (
            <div className="mt-3 space-y-5 border-t border-line pt-3">
              <div>
                <p className="text-sm font-medium text-star">
                  Connect {member.name}&apos;s school logins
                </p>
                <p className="mt-1 text-xs leading-relaxed text-dim">
                  Two separate logins. We&apos;ll test each one right now.
                  Passwords are only used for that check — never stored as plain text.
                </p>
              </div>

              {/* ParentVUE login */}
              <div className="rounded-xl border border-line bg-panel px-4 py-3">
                <p className="text-sm font-medium text-star">ParentVUE login</p>
                <p className="mt-0.5 text-xs text-dim">
                  Your parent portal account — used for grade pulls.
                </p>
                <div className="mt-3 space-y-2.5">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-stardust">
                      ParentVUE username
                    </span>
                    <input
                      value={parentUsername}
                      onChange={(e) => setParentUsername(e.target.value)}
                      placeholder="ParentVUE username"
                      autoComplete="off"
                      disabled={parentSaving}
                      className="w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-stardust">
                      ParentVUE password
                    </span>
                    <input
                      type="password"
                      value={parentPassword}
                      onChange={(e) => setParentPassword(e.target.value)}
                      placeholder="ParentVUE password"
                      autoComplete="new-password"
                      disabled={parentSaving}
                      className="w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                    />
                  </label>
                </div>
                {parentMessage && (
                  <p
                    role="alert"
                    className={`mt-2.5 rounded-xl border px-4 py-2.5 text-sm ${
                      parentMessage.ok
                        ? "border-neon-green/30 bg-neon-green/5 text-neon-green"
                        : "border-neon-amber/30 bg-neon-amber/5 text-neon-amber"
                    }`}
                  >
                    {parentMessage.text}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => submitParentLogin(member.id)}
                  disabled={parentSaving}
                  className="mt-3 w-full rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
                >
                  {parentSaving ? "Checking…" : "Test ParentVUE login"}
                </button>
              </div>

              {/* Student login */}
              <div className="rounded-xl border border-line bg-panel px-4 py-3">
                <p className="text-sm font-medium text-star">Student login</p>
                <p className="mt-0.5 text-xs text-dim">
                  {member.name}&apos;s school Microsoft account — used for StudentVUE,
                  Outlook, and CTLS Learn by the sync workers.
                </p>
                <div className="mt-3 space-y-2.5">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-stardust">
                      Student school email
                    </span>
                    <input
                      value={studentUsername}
                      onChange={(e) => setStudentUsername(e.target.value)}
                      placeholder="student@cobbk12.org"
                      autoComplete="off"
                      disabled={studentSaving}
                      className="w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-stardust">
                      Student password
                    </span>
                    <input
                      type="password"
                      value={studentPassword}
                      onChange={(e) => setStudentPassword(e.target.value)}
                      placeholder="Student password"
                      autoComplete="new-password"
                      disabled={studentSaving}
                      className="w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                    />
                  </label>
                </div>
                {studentMessage && (
                  <p
                    role="alert"
                    className={`mt-2.5 rounded-xl border px-4 py-2.5 text-sm ${
                      studentMessage.ok
                        ? "border-neon-green/30 bg-neon-green/5 text-neon-green"
                        : "border-neon-amber/30 bg-neon-amber/5 text-neon-amber"
                    }`}
                  >
                    {studentMessage.text}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => submitStudentLogin(member.id)}
                  disabled={studentSaving}
                  className="mt-3 w-full rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
                >
                  {studentSaving ? "Checking…" : "Test student login"}
                </button>
              </div>

              <button
                type="button"
                onClick={closeConnect}
                className="w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star"
              >
                Done
              </button>
            </div>
          )}
          {/* Sync now */}
          <div className="mt-3 border-t border-line pt-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-star">Refresh school data</p>
                <p className="mt-0.5 text-xs text-dim">
                  Checks for anything new from the school portals.
                </p>
              </div>
              <button
                type="button"
                onClick={() => syncNow(member.id)}
                disabled={syncNowBusy}
                className="shrink-0 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
              >
                {syncNowBusy ? "Checking…" : "Sync now"}
              </button>
            </div>
            {syncNowMessage && (
              <p
                role={syncNowMessage.ok ? "status" : "alert"}
                className={`mt-2.5 rounded-xl border px-4 py-2.5 text-sm ${
                  syncNowMessage.ok
                    ? "border-neon-green/30 bg-neon-green/5 text-neon-green"
                    : "border-neon-amber/30 bg-neon-amber/5 text-neon-amber"
                }`}
              >
                {syncNowMessage.text}
              </p>
            )}
          </div>
        </div>

        {/* Classes & grades */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
            Classes
          </p>
          {!classesLoading && gpaPick && (
            <div className="flex items-center justify-between rounded-xl border border-line bg-panel-2/60 px-4 py-2.5">
              <span className="text-sm text-stardust">
                GPA <span className="text-xs text-dim">· {gpaPick.label}</span>
              </span>
              <span className="text-lg font-bold text-star">{gpaPick.value.toFixed(2)}</span>
            </div>
          )}
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
              {classesStale && classesHours !== null && (
                <p
                  role="alert"
                  className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-sm text-neon-amber"
                >
                  These grades are{" "}
                  {classesHours >= 48
                    ? `${Math.round(classesHours / 24)} days`
                    : `${classesHours} hours`}{" "}
                  old. Sync the school login for the latest numbers.
                </p>
              )}
                            {classes.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedClassName(c.name)}
                  className="flex w-full items-center justify-between rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-left transition-colors hover:border-neon-green/30"
                  aria-label={`Open ${c.name} details`}
                >
                  <span className="text-sm text-star underline decoration-dotted decoration-dim/50 underline-offset-2">{c.name}</span>
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
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-dim">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
              {classesMessage || "No school data yet — connect a school login to see classes and grades."}
            </p>
          )}
        </div>

        {/* Attendance */}
        {!classesLoading && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
              Attendance
            </p>
            <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
              <p className="text-sm text-star">
                {attendance ? attendanceText(attendance) : "No attendance data in the latest sync."}
              </p>
            </div>
          </div>
        )}

        {/* School messages — Synergy + Outlook teacher mail, newest first */}
        {!classesLoading && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
              School messages{messages.length > 0 ? ` · ${messages.length}` : ""}
            </p>
            {messages.length === 0 ? (
              <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
                No school messages in the latest sync.
              </p>
            ) : (
              messages.map((m, i) => (
                <div
                  key={`msg-${i}-${m.date ?? ""}-${m.subject ?? ""}`}
                  className="rounded-xl border border-line bg-panel-2/60 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-star">
                      {m.subject || "(no subject)"}
                    </p>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-dim">
                      {m.source === "outlook" ? "Outlook" : "Synergy"}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-dim">
                    {m.sender ?? "School portal"}
                    {m.date && (
                      <>
                        {" · "}
                        {new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </>
                    )}
                  </p>
                  {m.preview && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-stardust">
                      {m.preview}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* School calendar & bell schedules */}
        <div className="space-y-2">
          <style>{SCHOOL_SOURCE_STYLES}</style>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
              School calendar &amp; bell schedules
            </p>
            {!srcLoading && (
              <button
                type="button"
                onClick={() => (srcEditing ? setSrcEditing(false) : openSourcesEditor())}
                className="shrink-0 rounded-lg border border-line bg-panel-2/60 px-3 py-1.5 text-xs font-medium text-stardust transition-colors hover:text-star"
              >
                {srcEditing ? "Done editing" : "Edit school sources"}
              </button>
            )}
          </div>

          {srcLoading ? (
            <p className="text-sm text-stardust">Loading calendar &amp; bell schedules…</p>
          ) : (
            <>
              {srcMessage && (
                <p
                  role={srcMessage.ok ? "status" : "alert"}
                  className={`rounded-xl border px-4 py-2.5 text-sm ${
                    srcMessage.ok
                      ? "border-neon-green/30 bg-neon-green/5 text-neon-green"
                      : "border-neon-amber/30 bg-neon-amber/5 text-neon-amber"
                  }`}
                >
                  {srcMessage.text}
                </p>
              )}
              {srcSources && (
                <p className="text-xs text-dim">
                  {srcSources.last_checked_at
                    ? `Last checked ${timeAgo(srcSources.last_checked_at) ?? "recently"}`
                    : "Not checked yet"}
                  {srcSources.check_status ? ` · ${srcSources.check_status}` : ""}
                  {srcSources.check_note ? ` — ${srcSources.check_note}` : ""}
                </p>
              )}

              {srcEditing && (
                <div className="space-y-2.5 rounded-xl border border-line bg-panel px-4 py-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-stardust">
                      School district
                    </span>
                    <input
                      value={srcDistrict}
                      onChange={(e) => setSrcDistrict(e.target.value)}
                      placeholder="e.g. Cobb County School District"
                      autoComplete="off"
                      disabled={srcSaving}
                      className="w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                    />
                  </label>
                  <div>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-stardust">
                        District calendar page URL
                      </span>
                      <input
                        value={srcCalendarUrl}
                        onChange={(e) => setSrcCalendarUrl(e.target.value)}
                        placeholder="https://…/calendars"
                        autoComplete="off"
                        inputMode="url"
                        disabled={srcSaving}
                        className="w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                      />
                    </label>
                    {srcSnapshots.calendar && (
                      <p
                        className={`mt-1 text-xs ${
                          srcSnapshots.calendar.status === "ok"
                            ? "text-dim"
                            : "text-neon-amber"
                        }`}
                      >
                        {srcSnapshots.calendar.status === "ok"
                          ? `Last pull ${timeAgo(srcSnapshots.calendar.fetched_at) ?? "recently"} — looks good.`
                          : `Last pull failed — ${srcSnapshots.calendar.error_note ?? "try Refresh."}`}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-stardust">Bell schedules</p>
                    {srcBells.map((b, i) => (
                      <div key={i} className="space-y-1">
                        <div className="grid grid-cols-[1fr_2fr_auto] items-center gap-2">
                          <input
                            aria-label={`Bell schedule ${i + 1} label`}
                            value={b.label}
                            onChange={(e) => updateBellRow(i, "label", e.target.value)}
                            placeholder="Daily"
                            autoComplete="off"
                            disabled={srcSaving}
                            className="w-full rounded-xl border border-line bg-panel-2/60 px-3 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                          />
                          <input
                            aria-label={`Bell schedule ${i + 1} URL`}
                            value={b.url}
                            onChange={(e) => updateBellRow(i, "url", e.target.value)}
                            placeholder="https://…/bell-schedule"
                            autoComplete="off"
                            inputMode="url"
                            disabled={srcSaving}
                            className="w-full rounded-xl border border-line bg-panel-2/60 px-3 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50"
                          />
                          {srcBells.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeBellRow(i)}
                              aria-label={`Remove bell schedule ${i + 1}`}
                              disabled={srcSaving}
                              className="rounded-lg border border-line bg-panel-2/60 px-2.5 py-2 text-sm text-dim transition-colors hover:text-red-400 disabled:opacity-50"
                            >
                              ✕
                            </button>
                          ) : (
                            <span aria-hidden="true" className="w-[37px]" />
                          )}
                        </div>
                        {srcSnapshots.bells[i] &&
                          srcSnapshots.bells[i].status !== "ok" && (
                            <p className="text-xs text-neon-amber">
                              Last pull failed —{" "}
                              {srcSnapshots.bells[i].error_note ?? "try Refresh."}
                            </p>
                          )}
                      </div>
                    ))}
                    {srcBells.length < 5 && (
                      <button
                        type="button"
                        onClick={addBellRow}
                        className="text-xs font-medium text-neon-green transition-opacity hover:opacity-80"
                      >
                        + Add another schedule
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => refreshSchoolSources(member.id)}
                      disabled={srcRefreshing || srcSaving}
                      className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
                    >
                      {srcRefreshing ? "Checking…" : "Refresh now"}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveSchoolSources(member.id)}
                      disabled={srcSaving || srcRefreshing}
                      className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
                    >
                      {srcSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              )}

              {/* Calendar display — always text, never a blank panel */}
              {srcSources?.calendar_source_url ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
                    Calendar
                  </p>
                  {calLoading ? (
                    <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-stardust">
                      Pulling the calendar in…
                    </p>
                  ) : calError ? (
                    <div
                      role="alert"
                      className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-3"
                    >
                      <p className="text-sm text-neon-amber">{calError}</p>
                      <button
                        type="button"
                        onClick={() => refreshSchoolSources(member.id)}
                        disabled={srcRefreshing}
                        className="mt-2 rounded-lg border border-neon-amber/40 bg-neon-amber/10 px-3 py-1.5 text-xs font-medium text-neon-amber transition-colors hover:bg-neon-amber/20 disabled:opacity-50"
                      >
                        {srcRefreshing ? "Checking…" : "Try again"}
                      </button>
                    </div>
                  ) : calHtml !== null ? (
                    <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
                      <div
                        className="school-source-content applet-scroll max-h-96 overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: calHtml }}
                      />
                      <p className="mt-2 border-t border-line pt-2 text-xs text-dim">
                        Source:{" "}
                        <a
                          href={calUrl || srcSources.calendar_source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-neon-green underline transition-opacity hover:opacity-80"
                        >
                          {domainOf(calUrl || srcSources.calendar_source_url)} ↗
                        </a>
                        {timeAgo(calFetchedAt) && (
                          <> · pulled {timeAgo(calFetchedAt)}</>
                        )}
                      </p>
                    </div>
                  ) : (
                    <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
                      The calendar isn&apos;t available right now — try Refresh
                      from the editor above.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
                  <p className="text-sm text-dim">
                    Add your district&apos;s calendar page to see it here.
                  </p>
                  {!srcEditing && (
                    <button
                      type="button"
                      onClick={openSourcesEditor}
                      className="mt-2 text-xs font-medium text-neon-green transition-opacity hover:opacity-80"
                    >
                      Add a calendar URL
                    </button>
                  )}
                </div>
              )}

              {/* Bell schedules collapsible */}
              <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    const next = !bellsOpen;
                    setBellsOpen(next);
                    if (next && (srcSources?.bell_schedules.length ?? 0) > 0) {
                      setBellError("");
                      ensureBellContent(member.id, bellTab);
                    }
                  }}
                  aria-expanded={bellsOpen}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="text-sm font-medium text-star">Bell schedules</span>
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
                    className={`text-dim transition-transform ${bellsOpen ? "rotate-180" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {bellsOpen && (
                  <div className="mt-3">
                    {(srcSources?.bell_schedules.length ?? 0) === 0 ? (
                      <p className="text-sm text-dim">
                        No bell schedules saved yet — add one with “Edit school
                        sources”.
                      </p>
                    ) : (
                      <>
                        <div
                          className="flex flex-wrap gap-1.5"
                          role="tablist"
                          aria-label="Bell schedules"
                        >
                          {(srcSources?.bell_schedules ?? []).map((b, i) => (
                            <button
                              key={`${b.label}-${i}`}
                              type="button"
                              role="tab"
                              aria-selected={bellTab === i}
                              onClick={() => {
                                setBellTab(i);
                                setBellError("");
                                ensureBellContent(member.id, i);
                              }}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                bellTab === i
                                  ? "border-neon-green/50 bg-neon-green/10 text-neon-green"
                                  : "border-line bg-panel-2/60 text-stardust hover:text-star"
                              }`}
                            >
                              {b.label || `Schedule ${i + 1}`}
                            </button>
                          ))}
                        </div>
                        <div role="tabpanel" className="mt-2">
                          {bellLoading ? (
                            <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-stardust">
                              Pulling that schedule in…
                            </p>
                          ) : bellError ? (
                            <div
                              role="alert"
                              className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-3"
                            >
                              <p className="text-sm text-neon-amber">{bellError}</p>
                              <button
                                type="button"
                                onClick={() => refreshSchoolSources(member.id)}
                                disabled={srcRefreshing}
                                className="mt-2 rounded-lg border border-neon-amber/40 bg-neon-amber/10 px-3 py-1.5 text-xs font-medium text-neon-amber transition-colors hover:bg-neon-amber/20 disabled:opacity-50"
                              >
                                {srcRefreshing ? "Checking…" : "Try again"}
                              </button>
                            </div>
                          ) : bellHtml[bellTab] !== undefined ? (
                            <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
                              <div
                                className="school-source-content applet-scroll max-h-96 overflow-y-auto"
                                dangerouslySetInnerHTML={{ __html: bellHtml[bellTab] }}
                              />
                              {bellMeta[bellTab]?.url && (
                                <p className="mt-2 border-t border-line pt-2 text-xs text-dim">
                                  Source:{" "}
                                  <a
                                    href={bellMeta[bellTab].url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-neon-green underline transition-opacity hover:opacity-80"
                                  >
                                    {domainOf(bellMeta[bellTab].url)} ↗
                                  </a>
                                  {timeAgo(bellMeta[bellTab].fetchedAt) && (
                                    <> · pulled {timeAgo(bellMeta[bellTab].fetchedAt)}</>
                                  )}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
                              The schedule isn&apos;t available right now — try
                              Refresh from the editor above.
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Manage — link code + remove */}
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
            Manage
          </p>

          {linkCodeFor !== member.id ? (
            <button
              type="button"
              onClick={() => {
                setLinkCodeFor(member.id);
                setLinkCode(null);
                setLinkCodeError("");
              }}
              className="w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-left text-sm text-stardust transition-colors hover:border-neon-green/30 hover:text-star"
            >
              Share a link code
              <span className="mt-0.5 block text-xs text-dim">
                For another parent or family member in the same room.
              </span>
            </button>
          ) : (
            <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
              <p className="text-sm font-medium text-star">Same-room link code</p>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                The other person enters this code to link {member.name}&apos;s
                profile. It works once and expires 15 minutes after it&apos;s created.
              </p>
              {!linkCode ? (
                <button
                  type="button"
                  onClick={() => mintLinkCode(member.id)}
                  disabled={linkCodeBusy}
                  className="mt-3 w-full rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
                >
                  {linkCodeBusy ? "Creating…" : "Create a code"}
                </button>
              ) : (
                <div>
                  <p className="mt-3 text-center font-mono text-4xl font-bold tracking-[0.35em] text-neon-green">
                    {linkCode.code}
                  </p>
                  <p className="mt-1 text-center text-xs text-dim">
                    Good until{" "}
                    {new Date(linkCode.expires_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    — one use only.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(linkCode.code).catch(() => {})}
                      className="flex-1 rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star"
                    >
                      Copy code
                    </button>
                    <button
                      type="button"
                      onClick={() => mintLinkCode(member.id)}
                      disabled={linkCodeBusy}
                      className="flex-1 rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
                    >
                      {linkCodeBusy ? "Creating…" : "New code"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLinkCodeFor(null);
                        setLinkCode(null);
                      }}
                      className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
              {linkCodeError && (
                <p role="alert" className="mt-2.5 text-xs text-neon-amber">
                  {linkCodeError}
                </p>
              )}
            </div>
          )}

          {!confirmRemove ? (
            <button
              type="button"
              onClick={() => {
                setConfirmRemove(true);
                setRemoveError("");
              }}
              className="w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-left text-sm text-dim transition-colors hover:border-red-400/40 hover:text-red-400"
            >
              Remove {member.name} from crew
            </button>
          ) : (
            <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3">
              <p className="text-sm font-medium text-star">
                Remove {member.name}?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                This deletes their crew profile and all synced school data.
                This can&apos;t be undone.
              </p>
              {removeError && (
                <p role="alert" className="mt-2 text-xs text-red-400">
                  {removeError}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  disabled={removing}
                  className="flex-1 rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
                >
                  Keep them
                </button>
                <button
                  type="button"
                  onClick={() => removeMember(member.id)}
                  disabled={removing}
                  className="flex-1 rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-400/20 disabled:opacity-50"
                >
                  {removing ? "Removing…" : "Yes, remove"}
                </button>
              </div>
            </div>
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
        {sourcesNote && (
          <p
            role="alert"
            className="mx-auto max-w-sm rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-sm text-neon-amber"
          >
            {sourcesNote}
          </p>
        )}
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
          <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
            <p className="text-xs font-medium text-stardust">
              School calendar &amp; bell schedule{" "}
              <span className="text-dim">(optional)</span>
            </p>
            <p className="mt-0.5 text-xs text-dim">
              Paste these now and Crystal will show them on{" "}
              {name ? `${name}'s` : "their"} profile.
            </p>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium text-stardust">
                District calendar page URL
              </span>
              <input
                value={newCalendarUrl}
                onChange={(e) => setNewCalendarUrl(e.target.value)}
                placeholder="https://…/calendars"
                autoComplete="off"
                inputMode="url"
                className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
              />
            </label>
            <div className="mt-2.5 grid grid-cols-[1fr_2fr] gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-stardust">
                  Bell schedule label
                </span>
                <input
                  value={newBellLabel}
                  onChange={(e) => setNewBellLabel(e.target.value)}
                  placeholder="Daily"
                  autoComplete="off"
                  className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-stardust">
                  Bell schedule URL
                </span>
                <input
                  value={newBellUrl}
                  onChange={(e) => setNewBellUrl(e.target.value)}
                  placeholder="https://…/bell-schedule"
                  autoComplete="off"
                  inputMode="url"
                  className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
                />
              </label>
            </div>
          </div>
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
