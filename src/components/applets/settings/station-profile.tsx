"use client";

import { useEffect, useRef, useState } from "react";
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

interface ProfileData {
  display_name: string;
  email: string;
  avatar_url: string | null;
  timezone: string;
  home_location: string | null;
  weather_units: "F" | "C";
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Downscale a picked photo to 128px so it stores cheaply as a data URL. */
function downscalePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas unavailable"));
        return;
      }
      const side = Math.min(img.width, img.height);
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("could not read image"));
    };
    img.src = objectUrl;
  });
}

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

function tzLabel(tz: string): string {
  return tz.replace("America/", "").replace(/_/g, " ") + " time";
}

/**
 * Station 1 — Your profile.
 * Name, sign-in email (read-only), photo, timezone, coarse home location,
 * and the °F/°C temperature choice shared with the weather panel.
 */
export function StationProfile({ onBack }: { onBack: () => void }) {
  const { value: avatar, update: updateAvatar, loading: avatarLoading } =
    usePanelSettings("profile");
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [location, setLocation] = useState("");
  const [locSaved, setLocSaved] = useState(false);
  const [savingField, setSavingField] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load the pilots-row profile on mount (and seed the form fields once).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/settings/profile");
        if (res.status === 401) return;
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "load failed");
        if (!cancelled) {
          const p: ProfileData = json.profile;
          setProfile(p);
          setName(p.display_name);
          setLocation(p.home_location ?? "");
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Couldn't load your profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function patchProfile(patch: Record<string, unknown>, done: () => void) {
    setSavingField(true);
    setError("");
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "save failed");
      setProfile((prev) => (prev ? ({ ...prev, ...patch } as ProfileData) : prev));
      done();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
    } finally {
      setSavingField(false);
    }
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setError("");
    try {
      const dataUrl = await downscalePhoto(file);
      await patchProfile({ avatar_url: dataUrl }, () => {});
      await updateAvatar({ avatar_url: dataUrl }, { silent: true });
    } catch {
      setError("Couldn't use that photo. Try a JPG or PNG file.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await patchProfile({ avatar_url: null }, () => {});
      await updateAvatar({ avatar_url: null }, { silent: true });
    } catch {
      setError("Couldn't remove the photo. Try again.");
    } finally {
      setPhotoBusy(false);
    }
  }

  if (loading || avatarLoading) {
    return (
      <div aria-busy="true">
        <BackButton onClick={onBack} label="Back to settings" />
        <p className="text-sm text-stardust">Loading your profile…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div>
        <BackButton onClick={onBack} label="Back to settings" />
        <Notice tone="warn">
          {error || "We couldn't reach your profile right now."} Try reopening
          this panel.
        </Notice>
      </div>
    );
  }

  const avatarUrl = profile.avatar_url ?? avatar.avatar_url;
  const initials = initialsOf(profile.display_name || profile.email);

  return (
    <div>
      <BackButton onClick={onBack} label="Back to settings" />
      <Panel
        kicker="Settings · 1 of 7"
        title="Your profile"
        intro="This is how Cockpit knows you — your name, your photo, and where home is."
      >
        {error && <Notice tone="warn">{error}</Notice>}

        {/* Photo */}
        <SettingRow
          label="Photo"
          blurb={SETTING_BLURBS.avatar_url}
          control={
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy}
              className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-line bg-panel text-lg font-semibold text-neon-teal transition-colors hover:border-neon-teal/50 disabled:opacity-50"
              aria-label="Change your photo"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span aria-hidden="true">{initials}</span>
              )}
            </button>
          }
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            aria-label="Pick a photo"
            onChange={(e) => onPickPhoto(e.target.files?.[0])}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy}
              className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
            >
              {photoBusy ? "Working…" : avatarUrl ? "Change photo" : "Add a photo"}
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={removePhoto}
                disabled={photoBusy}
                className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        </SettingRow>

        {/* Name */}
        <SettingRow
          label="Name"
          blurb="What Crystal calls you. A nickname is fine."
          control={
            <button
              type="button"
              onClick={() => patchProfile({ display_name: name }, () => setNameSaved(true))}
              disabled={savingField || !name.trim()}
              className="rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20 disabled:opacity-50"
            >
              {savingField ? "Saving…" : "Save"}
            </button>
          }
        >
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameSaved(false);
            }}
            placeholder="Your name"
            autoComplete="name"
            className={inputCls}
          />
          {nameSaved && (
            <p className="mt-1.5 text-xs text-neon-green">Saved.</p>
          )}
        </SettingRow>

        {/* Email — read-only */}
        <SettingRow
          label="Sign-in email"
          blurb="This is the email you signed in with. It can't be changed here — it belongs to your sign-in provider."
        >
          <p className="rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-dim">
            {profile.email || "—"}
          </p>
        </SettingRow>

        {/* Timezone */}
        <SettingRow
          label="Timezone"
          blurb="Cockpit uses this for reminders, the daily recap, and quiet hours."
          control={
            savingField ? (
              <span className="text-xs text-dim">Saving…</span>
            ) : null
          }
        >
          <select
            value={profile.timezone}
            onChange={(e) =>
              patchProfile({ timezone: e.target.value }, () => {})
            }
            disabled={savingField}
            aria-label="Timezone"
            className={`${inputCls} appearance-none`}
          >
            {!TIMEZONES.includes(profile.timezone) && (
              <option value={profile.timezone}>{profile.timezone}</option>
            )}
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tzLabel(tz)}
              </option>
            ))}
          </select>
        </SettingRow>

        {/* Coarse home location */}
        <SettingRow
          label="Home location"
          blurb="City or ZIP only — Cockpit never needs your exact address. Used for local weather."
          control={
            <button
              type="button"
              onClick={() => patchProfile({ home_location: location }, () => setLocSaved(true))}
              disabled={savingField}
              className="rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20 disabled:opacity-50"
            >
              {savingField ? "Saving…" : "Save"}
            </button>
          }
        >
          <input
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setLocSaved(false);
            }}
            placeholder="e.g. Marietta, GA"
            autoComplete="off"
            className={inputCls}
          />
          {locSaved && <p className="mt-1.5 text-xs text-neon-green">Saved.</p>}
        </SettingRow>

        {/* °F / °C */}
        <SettingRow label="Temperature units" blurb="Used everywhere temperatures appear — weather, health, travel.">
          <Segmented
            label="Temperature units"
            value={profile.weather_units}
            onChange={(v) => patchProfile({ weather_units: v }, () => {})}
            options={[
              { value: "F", label: "°F Fahrenheit" },
              { value: "C", label: "°C Celsius" },
            ]}
          />
        </SettingRow>
      </Panel>
    </div>
  );
}
