"use client";

import { useEffect, useState } from "react";

export interface CrewRosterMember {
  id: string;
  name: string;
  relationship?: string | null;
  school_sync?: { sync_status: string; last_synced_at: string | null };
}

interface RosterState {
  members: CrewRosterMember[];
  loading: boolean;
}

// One shared in-flight request per page load — every toolbar variant, the
// home stations grid, and the school station all ask the same question
// (does the pilot have linked children?), so they share one fetch.
let inflight: Promise<CrewRosterMember[]> | null = null;

function fetchRoster(): Promise<CrewRosterMember[]> {
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch("/api/crew/members");
        if (!res.ok) return [];
        const json = await res.json();
        return Array.isArray(json.members) ? (json.members as CrewRosterMember[]) : [];
      } catch {
        // Unreachable / signed out: treat as no linked children. The
        // surfaces that need data show their own honest states.
        return [];
      }
    })();
  }
  return inflight;
}

/** The pilot's linked children (crew members). Shared + cached per page load. */
export function useCrewRoster(): RosterState {
  const [state, setState] = useState<RosterState>({ members: [], loading: true });
  useEffect(() => {
    let alive = true;
    fetchRoster().then((members) => {
      if (alive) setState({ members, loading: false });
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/**
 * The conditional School tab (and the Family & School home button) render
 * iff the pilot has ≥1 linked child. Per D4: on child add, not after first
 * sync — the school station shows honest "syncing…" states until data lands.
 */
export function useHasLinkedChildren(): boolean {
  const { members, loading } = useCrewRoster();
  return !loading && members.length > 0;
}
