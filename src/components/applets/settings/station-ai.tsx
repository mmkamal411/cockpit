"use client";

import { usePanelSettings } from "./use-panel-settings";
import {
  BackButton,
  Notice,
  Panel,
  Segmented,
  SettingRow,
  Switch,
} from "./settings-ui";
import { SETTING_BLURBS } from "@/lib/pilot-settings";

/**
 * Station 4 — Crystal.
 * AI preferences, not mode switching: persona switching is keyword-only
 * (say "fireball" or "crystal" — it listens for the word), so there is no
 * toggle here. This panel covers how proactive Crystal is, whether it learns
 * from corrections, and the D2 safety floor for 13–17.
 */
export function StationAI({ onBack }: { onBack: () => void }) {
  const { value, update, loading, saving, error } = usePanelSettings("crystal");

  if (loading) {
    return (
      <div aria-busy="true">
        <BackButton onClick={onBack} label="Back to settings" />
        <p className="text-sm text-stardust">Loading Crystal&apos;s settings…</p>
      </div>
    );
  }

  return (
    <div>
      <BackButton onClick={onBack} label="Back to settings" />
      <Panel
        kicker="Settings · 4 of 7"
        title="Crystal"
        intro="How your AI co-pilot behaves — how eager it is, and whether it learns from your corrections."
      >
        {error && <Notice tone="warn">{error}</Notice>}
        {saving && (
          <p className="text-xs text-dim" aria-live="polite">
            Saving…
          </p>
        )}

        <SettingRow
          label={`Proactive help: ${value.proactive_help === "off" ? "off" : value.proactive_help === "gentle" ? "gentle" : "eager"}`}
          blurb={SETTING_BLURBS.proactive_help}
        >
          <Segmented
            label="Proactive help level"
            value={value.proactive_help}
            onChange={(v) => update({ proactive_help: v })}
            options={[
              { value: "off", label: "Off", hint: "Crystal only answers when you ask" },
              { value: "gentle", label: "Gentle", hint: "Occasional helpful nudges" },
              { value: "eager", label: "Eager", hint: "Crystal brings things up before you ask" },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={`Learn from corrections: ${value.learn_from_corrections ? "on" : "off"}`}
          blurb={SETTING_BLURBS.learn_from_corrections}
          control={
            <Switch
              checked={value.learn_from_corrections}
              onChange={(on) => update({ learn_from_corrections: on })}
              label="Learn from corrections"
            />
          }
        />

        <SettingRow
          label="Switching modes"
          blurb="There is no button for this — it's keyword-only. Say “fireball” when you want direct, no-nonsense answers, and “crystal” to come back to the warm co-pilot. Crystal listens for the word."
        />

        <SettingRow
          label="Safety floor for ages 13–17"
          blurb="For teens, Crystal stays completely unfiltered and intelligent — with one narrow duty-of-care exception: talk of self-harm, eating disorders, abuse, or sexual content involving minors is routed to 988 and a trusted adult. This is crisis care, not a filter. Everything else works exactly as you see it."
        />
      </Panel>
    </div>
  );
}
