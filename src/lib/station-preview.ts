/**
 * Station preview data — lazy, cached, and cheap.
 *
 * Rules (protect the Supabase Free tier):
 * - Fetch ONLY when a station is selected (preview trigger), never on deck
 *   mount. Thirty-one stations × auth round trips on mount would hammer the
 *   free tier.
 * - Hand-rolled 5-minute TTL cache (~40 lines). Invalidate on applet close
 *   so a station you just used never shows stale data.
 * - Any failure degrades to null — the UI shows the blurb without a datum.
 */

"use client";

import { useEffect, useState } from "react";
import type { StationDef } from "./stations";

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  at: number;
  datum: string | null;
}

const cache = new Map<string, CacheEntry>();

/** Drop cached preview data, e.g. after the pilot closes a station applet. */
export function invalidateStationPreviews(stationId?: string) {
  if (stationId) {
    cache.delete(stationId);
  } else {
    cache.clear();
  }
}

async function fetchDatum(station: StationDef): Promise<string | null> {
  if (!station.preview) return null;
  try {
    const res = await fetch(station.preview.endpoint, { credentials: "same-origin" });
    if (!res.ok) return null;
    const json = await res.json();
    return station.preview.pick(json);
  } catch {
    return null;
  }
}

/**
 * Returns the freshest live datum for the selected station, or null while
 * loading / unavailable. Pass null to idle (no fetch).
 */
export function useStationPreview(station: StationDef | null): string | null {
  const [datum, setDatum] = useState<string | null>(null);

  useEffect(() => {
    if (!station?.preview) {
      setDatum(null);
      return;
    }
    const key = station.id;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      setDatum(hit.datum);
      return;
    }
    let cancelled = false;
    setDatum(null);
    fetchDatum(station).then((d) => {
      if (cancelled) return;
      cache.set(key, { at: Date.now(), datum: d });
      setDatum(d);
    });
    return () => {
      cancelled = true;
    };
  }, [station]);

  return datum;
}
