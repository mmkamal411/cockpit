"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePanelSettings } from "./use-panel-settings";
import {
  BackButton,
  Notice,
  Panel,
  Segmented,
  SettingRow,
  inputCls,
} from "./settings-ui";
import { SETTING_BLURBS } from "@/lib/pilot-settings";

const RETENTION_OPTIONS = [
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 0, label: "Keep forever" },
];

/**
 * Station 7 — Privacy & data.
 * How long data is kept, a full download of everything, cookie choice,
 * sign out, and the DangerZone delete — type-to-confirm with a 30-day
 * grace period. Everything is plain-English; nothing here is a dead end.
 */
export function StationPrivacy({ onBack }: { onBack: () => void }) {
  const { value, update, loading, saving, error } = usePanelSettings("privacy");

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [account, setAccount] = useState<{
    deletion_requested_at: string | null;
    erase_date: string | null;
    grace_days: number;
  } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerError, setDangerError] = useState("");
  const [dangerDone, setDangerDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [acctRes, profRes] = await Promise.all([
          fetch("/api/settings/account"),
          fetch("/api/settings/profile"),
        ]);
        if (acctRes.ok && !cancelled) setAccount(await acctRes.json());
        if (profRes.ok && !cancelled) {
          const json = await profRes.json();
          setUserEmail(json.profile?.email ?? "");
        }
      } catch {
        // Account-status read failure is non-fatal; the danger zone will
        // re-check before doing anything destructive.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function downloadData() {
    setExporting(true);
    setExportError("");
    try {
      const res = await fetch("/api/settings/export");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Couldn't prepare your download.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cockpit-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Couldn't prepare your download.");
    } finally {
      setExporting(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      window.location.href = "/";
    }
  }

  async function requestDelete() {
    setDangerBusy(true);
    setDangerError("");
    try {
      const res = await fetch("/api/settings/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't start the deletion.");
      setAccount({
        deletion_requested_at: new Date().toISOString(),
        erase_date: json.erase_date,
        grace_days: json.grace_days,
      });
      setDangerDone(true);
      setConfirmText("");
    } catch (e) {
      setDangerError(e instanceof Error ? e.message : "Couldn't start the deletion.");
    } finally {
      setDangerBusy(false);
    }
  }

  async function cancelDelete() {
    setDangerBusy(true);
    setDangerError("");
    try {
      const res = await fetch("/api/settings/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't cancel.");
      setAccount((a) => (a ? { ...a, deletion_requested_at: null, erase_date: null } : a));
      setDangerDone(false);
    } catch (e) {
      setDangerError(e instanceof Error ? e.message : "Couldn't cancel the deletion.");
    } finally {
      setDangerBusy(false);
    }
  }

  if (loading) {
    return (
      <div aria-busy="true">
        <BackButton onClick={onBack} label="Back to settings" />
        <p className="text-sm text-stardust">Loading privacy settings…</p>
      </div>
    );
  }

  const pendingDelete = !!account?.deletion_requested_at;

  return (
    <div>
      <BackButton onClick={onBack} label="Back to settings" />
      <Panel
        kicker="Settings · 7 of 7"
        title="Privacy &amp; data"
        intro="What Cockpit keeps, how long it keeps it, and how to take it all with you — or leave entirely."
      >
        {error && <Notice tone="warn">{error}</Notice>}
        {saving && (
          <p className="text-xs text-dim" aria-live="polite">
            Saving…
          </p>
        )}

        {/* Retention */}
        <SettingRow label="How long we keep your data" blurb={SETTING_BLURBS.retention_days}>
          <Segmented
            label="Data retention"
            value={String(value.retention_days)}
            onChange={(v) => update({ retention_days: Number(v) })}
            options={RETENTION_OPTIONS.map((o) => ({
              value: String(o.days),
              label: o.label,
            }))}
          />
        </SettingRow>

        {/* Download */}
        <SettingRow
          label="Download my data"
          blurb="A single file with everything Cockpit holds about you — your profile, settings, crew names, to-dos, and layout. Passwords and login tokens are never stored by Cockpit, so they're not in the file either."
        >
          <button
            type="button"
            onClick={downloadData}
            disabled={exporting}
            className="rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20 disabled:opacity-50"
          >
            {exporting ? "Preparing…" : "Download my data"}
          </button>
          {exportError && (
            <p role="alert" className="mt-1.5 text-xs text-neon-amber">
              {exportError}
            </p>
          )}
        </SettingRow>

        {/* Cookies */}
        <SettingRow label="Cookies" blurb={SETTING_BLURBS.cookies}>
          <Segmented
            label="Cookie choice"
            value={value.cookies}
            onChange={(v) => update({ cookies: v })}
            options={[
              { value: "essential", label: "Essential only" },
              { value: "all", label: "All cookies" },
            ]}
          />
        </SettingRow>

        {/* Sign out */}
        <SettingRow
          label="Sign out"
          blurb="Signs you out of Cockpit on this device. Your data stays right where you left it."
        >
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </SettingRow>

        {/* DangerZone */}
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3">
          <p className="text-sm font-medium text-red-300">Delete my account</p>
          <p className="mt-0.5 text-xs leading-relaxed text-stardust">
            This is the big red button. Type your sign-in email below to start a
            30-day countdown — at the end, everything is erased for good. Sign
            in again before then and the deletion is cancelled automatically.
          </p>

          {pendingDelete && account?.erase_date ? (
            <div className="mt-3 space-y-2">
              <Notice tone="warn">
                Deletion is scheduled for{" "}
                {new Date(account.erase_date).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                . Sign in again before then to cancel it automatically — or
                cancel it right now:
              </Notice>
              <button
                type="button"
                onClick={cancelDelete}
                disabled={dangerBusy}
                className="w-full rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20 disabled:opacity-50"
              >
                {dangerBusy ? "Working…" : "Cancel the deletion — keep my account"}
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-stardust">
                  Type your sign-in email to confirm
                </span>
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={userEmail || "you@example.com"}
                  autoComplete="off"
                  disabled={dangerBusy}
                  className={inputCls}
                />
              </label>
              {dangerError && (
                <p role="alert" className="text-xs text-neon-amber">
                  {dangerError}
                </p>
              )}
              {dangerDone && (
                <Notice tone="info">
                  Deletion scheduled. You have 30 days to change your mind —
                  just sign in again.
                </Notice>
              )}
              <button
                type="button"
                onClick={requestDelete}
                disabled={dangerBusy || !confirmText.trim()}
                className="w-full rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                {dangerBusy ? "Working…" : "Start the 30-day deletion countdown"}
              </button>
              <p className="pt-1 text-[11px] text-dim">
                Typing your email IS the confirmation — there is no second screen.
              </p>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
