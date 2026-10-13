"use client";

import { useEffect, useState } from "react";
import { usePanelSettings } from "./use-panel-settings";
import {
  BackButton,
  Notice,
  Panel,
  Segmented,
  SettingRow,
  Switch,
} from "./settings-ui";
import {
  DEFAULT_SETTINGS,
  SETTING_BLURBS,
  type CockpitSettings,
  type NeonAccent,
} from "@/lib/pilot-settings";

const STATION_META: { id: string; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "crystal", label: "Crystal" },
  { id: "progress", label: "Progress" },
  { id: "health", label: "Health" },
  { id: "money", label: "Money" },
  { id: "mail", label: "Mail" },
  { id: "shopping", label: "Shopping" },
  { id: "travel", label: "Travel" },
  { id: "learn", label: "Learn" },
  { id: "crew", label: "Crew" },
];

const WIDGET_META: { id: string; label: string }[] = [
  { id: "weather", label: "Weather" },
  { id: "calendar", label: "Calendar" },
  { id: "todos", label: "To-dos" },
  { id: "progress", label: "Progress" },
  { id: "school", label: "School" },
  { id: "mail", label: "Mail" },
];

function stationLabel(id: string): string {
  return STATION_META.find((s) => s.id === id)?.label ?? id;
}

/**
 * Station 5 — Your cockpit (the ship).
 * Home-station order with up/down controls and a live preview — never a raw
 * editor. Saves to cockpit_layouts (the active row), which fills the
 * layer-2 personalization gap: the ship now remembers how you arranged it.
 */
export function StationShip({ onBack }: { onBack: () => void }) {
  const {
    value: prefs,
    update: updatePrefs,
    loading: prefsLoading,
    error: prefsError,
  } = usePanelSettings("cockpit");

  const [order, setOrder] = useState<string[]>(DEFAULT_SETTINGS.cockpit.home_stations);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [layoutError, setLayoutError] = useState("");
  const [layoutSaving, setLayoutSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/settings/layout");
        if (res.status === 401) return;
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "load failed");
        if (!cancelled && Array.isArray(json.layout?.home_stations)) {
          setOrder(json.layout.home_stations as string[]);
        }
      } catch (e) {
        if (!cancelled)
          setLayoutError(
            e instanceof Error ? e.message : "Couldn't load your layout.",
          );
      } finally {
        if (!cancelled) setLayoutLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveOrder(next: string[]) {
    setOrder(next);
    setLayoutSaving(true);
    setLayoutError("");
    try {
      const res = await fetch("/api/settings/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          home_stations: next,
          hero_widgets: prefs.hero_widgets,
          neon_accent: prefs.neon_accent,
          reduce_motion: prefs.reduce_motion,
          celebrations: prefs.celebrations,
          orb_behavior: prefs.orb_behavior,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "save failed");
      // Mirror the order into the settings namespace too (cheap + consistent).
      await updatePrefs({ home_stations: next }, { silent: true });
    } catch (e) {
      setLayoutError(e instanceof Error ? e.message : "Couldn't save your layout.");
    } finally {
      setLayoutSaving(false);
    }
  }

  function move(id: string, dir: -1 | 1) {
    const idx = order.indexOf(id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[idx], next[target]] = [next[target], next[idx]];
    void saveOrder(next);
  }

  function toggleWidget(id: string) {
    const on = prefs.hero_widgets.includes(id);
    const next = on
      ? prefs.hero_widgets.filter((w) => w !== id)
      : [...prefs.hero_widgets, id];
    void updatePrefs({ hero_widgets: next });
  }

  async function savePref<K extends keyof CockpitSettings>(
    patch: Pick<CockpitSettings, K>,
  ) {
    await updatePrefs(patch);
  }

  if (prefsLoading || layoutLoading) {
    return (
      <div aria-busy="true">
        <BackButton onClick={onBack} label="Back to settings" />
        <p className="text-sm text-stardust">Loading your cockpit…</p>
      </div>
    );
  }

  return (
    <div>
      <BackButton onClick={onBack} label="Back to settings" />
      <Panel
        kicker="Settings · 5 of 7"
        title="Your cockpit"
        intro="Arrange your ship. What you open most should sit on top — the preview below updates live as you reorder."
      >
        {(prefsError || layoutError) && (
          <Notice tone="warn">{prefsError || layoutError}</Notice>
        )}
        {layoutSaving && (
          <p className="text-xs text-dim" aria-live="polite">
            Saving your layout…
          </p>
        )}

        {/* Live preview */}
        <div
          aria-label="Live preview of your home order"
          className="rounded-xl border border-neon-teal/25 bg-panel px-4 py-3"
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
            Live preview
          </p>
          <ol className="mt-2 flex flex-wrap gap-1.5">
            {order.map((id, i) => (
              <li
                key={id}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  i === 0
                    ? "border-neon-teal/50 bg-neon-teal/10 text-neon-teal"
                    : "border-line bg-panel-2/60 text-stardust"
                }`}
              >
                {stationLabel(id)}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-dim">
            {stationLabel(order[0])} is your first stop when you open the More
            view.
          </p>
        </div>

        {/* Reorder */}
        <SettingRow label="Home screen order" blurb={SETTING_BLURBS.home_stations}>
          <ul className="space-y-1.5">
            {order.map((id) => {
              const idx = order.indexOf(id);
              return (
                <li
                  key={id}
                  className="flex items-center justify-between rounded-lg border border-line/60 bg-panel px-3 py-2"
                >
                  <span className="text-sm text-star">
                    <span className="mr-2 text-xs text-dim">{idx + 1}</span>
                    {stationLabel(id)}
                  </span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => move(id, -1)}
                      disabled={idx === 0}
                      aria-label={`Move ${stationLabel(id)} up`}
                      className="rounded-lg border border-line bg-panel-2/60 px-2.5 py-1 text-sm text-stardust transition-colors hover:text-star disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(id, 1)}
                      disabled={idx === order.length - 1}
                      aria-label={`Move ${stationLabel(id)} down`}
                      className="rounded-lg border border-line bg-panel-2/60 px-2.5 py-1 text-sm text-stardust transition-colors hover:text-star disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </SettingRow>

        {/* Hero widgets */}
        <SettingRow label="Hero widgets" blurb={SETTING_BLURBS.hero_widgets}>
          <div className="flex flex-wrap gap-2">
            {WIDGET_META.map((w) => {
              const on = prefs.hero_widgets.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => toggleWidget(w.id)}
                  aria-pressed={on}
                  className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                    on
                      ? "border-neon-teal/50 bg-neon-teal/10 text-neon-teal"
                      : "border-line bg-panel-2/60 text-stardust hover:text-star"
                  }`}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        </SettingRow>

        {/* Neon accent */}
        <SettingRow label="Neon accent" blurb={SETTING_BLURBS.neon_accent}>
          <Segmented<NeonAccent>
            label="Neon accent color"
            value={prefs.neon_accent}
            onChange={(v) => savePref({ neon_accent: v })}
            options={[
              { value: "teal", label: "Teal" },
              { value: "green", label: "Green" },
              { value: "cyan", label: "Cyan" },
              { value: "amber", label: "Amber" },
              { value: "purple", label: "Purple" },
            ]}
          />
        </SettingRow>

        {/* Motion + celebrations */}
        <SettingRow
          label={`Reduce motion: ${prefs.reduce_motion ? "on" : "off"}`}
          blurb={SETTING_BLURBS.reduce_motion}
          control={
            <Switch
              checked={prefs.reduce_motion}
              onChange={(on) => savePref({ reduce_motion: on })}
              label="Reduce motion"
            />
          }
        />
        <SettingRow
          label={`Celebrations: ${prefs.celebrations ? "on" : "off"}`}
          blurb={SETTING_BLURBS.celebrations}
          control={
            <Switch
              checked={prefs.celebrations}
              onChange={(on) => savePref({ celebrations: on })}
              label="Celebrations"
            />
          }
        />

        {/* Orb behavior */}
        <SettingRow
          label={`Crystal's movement: ${prefs.orb_behavior === "calm" ? "calm" : "lively"}`}
          blurb={SETTING_BLURBS.orb_behavior}
        >
          <Segmented
            label="Orb behavior"
            value={prefs.orb_behavior}
            onChange={(v) => savePref({ orb_behavior: v })}
            options={[
              { value: "calm", label: "Calm", hint: "Drifts slowly, settles gently" },
              { value: "lively", label: "Lively", hint: "Moves around, reacts to you" },
            ]}
          />
        </SettingRow>
      </Panel>
    </div>
  );
}
