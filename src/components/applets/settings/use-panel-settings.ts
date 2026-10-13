"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AllSettings,
  DEFAULT_SETTINGS,
  SettingsNamespace,
  mergeSettings,
} from "@/lib/pilot-settings";

/**
 * Loads one settings namespace (merged over defaults) and saves partial
 * updates with an optimistic UI. Save errors surface as plain-English text
 * and roll the UI back to the last good value.
 */
export function usePanelSettings<K extends SettingsNamespace>(namespace: K) {
  const [value, setValue] = useState<AllSettings[K]>(
    () => DEFAULT_SETTINGS[namespace],
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/settings");
        if (res.status === 401) {
          if (!cancelled) setLoading(false);
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "load failed");
        const merged = mergeSettings(
          DEFAULT_SETTINGS[namespace] as Record<string, unknown>,
          (json.settings?.[namespace] ?? {}) as Record<string, unknown>,
        );
        if (!cancelled) setValue(merged as AllSettings[K]);
      } catch {
        if (!cancelled)
          setError("Couldn't load these settings right now. Try reopening this panel.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [namespace]);

  const update = useCallback(
    async (patch: Partial<AllSettings[K]>, opts?: { silent?: boolean }) => {
      const previous = value;
      const next = mergeSettings(
        previous as Record<string, unknown>,
        patch as Record<string, unknown>,
      ) as AllSettings[K];
      setValue(next);
      setSaving(true);
      if (!opts?.silent) setError("");
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ namespace, settings: patch }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "save failed");
        setSavedTick((t) => t + 1);
      } catch (e) {
        setValue(previous);
        setError(
          e instanceof Error ? e.message : "Couldn't save that. Try again.",
        );
      } finally {
        setSaving(false);
      }
    },
    [namespace, value],
  );

  return { value, setValue, update, loading, saving, error, savedTick };
}
