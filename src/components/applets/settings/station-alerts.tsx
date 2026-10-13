"use client";

import { usePanelSettings } from "./use-panel-settings";
import {
  BackButton,
  Notice,
  Panel,
  SettingRow,
  Slider,
  Switch,
  inputCls,
} from "./settings-ui";
import { SETTING_BLURBS, type AlertSettings } from "@/lib/pilot-settings";

const DOMAIN_LABELS: { key: keyof AlertSettings["domains"]; label: string }[] = [
  { key: "school", label: "School" },
  { key: "money", label: "Money" },
  { key: "health", label: "Health" },
  { key: "home", label: "Home" },
  { key: "travel", label: "Travel" },
];

function formatHour(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:00 ${suffix}`;
}

/**
 * Station 3 — Alerts.
 * The current state is prominent ("Grade alerts: on, target 90"); details
 * expand underneath. Every setting carries its plain-English "what this does".
 */
export function StationAlerts({ onBack }: { onBack: () => void }) {
  const { value, update, loading, saving, error } = usePanelSettings("alerts");

  if (loading) {
    return (
      <div aria-busy="true">
        <BackButton onClick={onBack} label="Back to settings" />
        <p className="text-sm text-stardust">Loading your alert settings…</p>
      </div>
    );
  }

  const updateDomains = (key: keyof AlertSettings["domains"], on: boolean) =>
    update({ domains: { ...value.domains, [key]: on } });
  const updateQuiet = (patch: Partial<AlertSettings["quiet_hours"]>) =>
    update({ quiet_hours: { ...value.quiet_hours, ...patch } });

  return (
    <div>
      <BackButton onClick={onBack} label="Back to settings" />
      <Panel
        kicker="Settings · 3 of 7"
        title="Alerts"
        intro="What Crystal tells you, and when. The bold line on each card is the current state — details are right underneath."
      >
        {error && <Notice tone="warn">{error}</Notice>}
        {saving && (
          <p className="text-xs text-dim" aria-live="polite">
            Saving…
          </p>
        )}

        {/* Grade alerts */}
        <SettingRow
          label={`Grade alerts: ${value.grade_alerts_enabled ? `on, target ${value.grade_drop_threshold}` : "off"}`}
          blurb={SETTING_BLURBS.grade_alerts_enabled}
          control={
            <Switch
              checked={value.grade_alerts_enabled}
              onChange={(on) => update({ grade_alerts_enabled: on })}
              label="Grade alerts"
            />
          }
        >
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-stardust">
              Target: {value.grade_drop_threshold}
            </p>
            <Slider
              label="Grade target"
              min={0}
              max={100}
              value={value.grade_drop_threshold}
              onChange={(v) => update({ grade_drop_threshold: v })}
            />
            <p className="text-xs text-dim">
              {SETTING_BLURBS.grade_drop_threshold}
            </p>
          </div>
        </SettingRow>

        {/* Domains */}
        <SettingRow
          label="Alert domains"
          blurb={SETTING_BLURBS.domains}
        >
          <div className="space-y-1.5">
            {DOMAIN_LABELS.map((d) => (
              <div
                key={d.key}
                className="flex items-center justify-between rounded-lg border border-line/60 bg-panel px-3 py-2"
              >
                <span className="text-sm text-star">{d.label}</span>
                <Switch
                  checked={value.domains[d.key]}
                  onChange={(on) => updateDomains(d.key, on)}
                  label={`${d.label} alerts`}
                />
              </div>
            ))}
          </div>
        </SettingRow>

        {/* Due-soon */}
        <SettingRow
          label={`Due-soon warnings: ${value.due_soon_enabled ? `on, ${value.due_soon_hours}h ahead` : "off"}`}
          blurb={SETTING_BLURBS.due_soon_enabled}
          control={
            <Switch
              checked={value.due_soon_enabled}
              onChange={(on) => update({ due_soon_enabled: on })}
              label="Due-soon warnings"
            />
          }
        >
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-stardust">
              Warn me {value.due_soon_hours} hours before
            </p>
            <Slider
              label="Hours ahead"
              min={1}
              max={168}
              value={value.due_soon_hours}
              onChange={(v) => update({ due_soon_hours: v })}
            />
            <p className="text-xs text-dim">{SETTING_BLURBS.due_soon_hours}</p>
          </div>
        </SettingRow>

        {/* Daily reminder */}
        <SettingRow
          label={`Daily recap: ${value.daily_reminder ? `on, ${value.daily_reminder_time}` : "off"}`}
          blurb={SETTING_BLURBS.daily_reminder}
          control={
            <Switch
              checked={value.daily_reminder}
              onChange={(on) => update({ daily_reminder: on })}
              label="Daily recap"
            />
          }
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">
              {SETTING_BLURBS.daily_reminder_time}
            </span>
            <input
              type="time"
              value={value.daily_reminder_time}
              onChange={(e) => update({ daily_reminder_time: e.target.value })}
              className={`${inputCls} max-w-44`}
            />
          </label>
        </SettingRow>

        {/* Quiet hours */}
        <SettingRow
          label={`Quiet hours: ${value.quiet_hours.enabled ? `${formatHour(Number(value.quiet_hours.start.slice(0, 2)))} – ${formatHour(Number(value.quiet_hours.end.slice(0, 2)))}` : "off"}`}
          blurb={SETTING_BLURBS.quiet_hours}
          control={
            <Switch
              checked={value.quiet_hours.enabled}
              onChange={(on) => updateQuiet({ enabled: on })}
              label="Quiet hours"
            />
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stardust">
                From
              </span>
              <input
                type="time"
                value={value.quiet_hours.start}
                onChange={(e) => updateQuiet({ start: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stardust">
                Until
              </span>
              <input
                type="time"
                value={value.quiet_hours.end}
                onChange={(e) => updateQuiet({ end: e.target.value })}
                className={inputCls}
              />
            </label>
          </div>
        </SettingRow>

        {/* Urgent breakthrough */}
        <SettingRow
          label={`Urgent breakthrough: ${value.urgent_breakthrough ? "on" : "off"}`}
          blurb={SETTING_BLURBS.urgent_breakthrough}
          control={
            <Switch
              checked={value.urgent_breakthrough}
              onChange={(on) => update({ urgent_breakthrough: on })}
              label="Urgent breakthrough"
            />
          }
        />

        {/* Sensitivity */}
        <SettingRow
          label="Sensitivity"
          blurb={SETTING_BLURBS.sensitivity}
        >
          <Slider
            label="Alert sensitivity"
            min={0}
            max={100}
            value={value.sensitivity}
            onChange={(v) => update({ sensitivity: v })}
          />
          <p className="mt-1 text-xs text-dim">
            {value.sensitivity < 34
              ? "Low — only the sure things."
              : value.sensitivity < 67
                ? "Balanced — the everyday mix."
                : "High — Crystal mentions the maybes too."}
          </p>
        </SettingRow>
      </Panel>
    </div>
  );
}
