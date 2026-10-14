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
  /**
   * True when the viewer holds a live access grant as grantee — i.e. they
   * are a linked family member (usually a child), not the steward.
   * Parent-only actions ("Add a child") must be hidden when true.
   */
  viewerIsFamilyMember: boolean;
}

// One shared in-flight request per page load — every toolbar variant, the
// home stations grid, and the school station all ask the same question
// (does the pilot have linked children?), so they share one fetch.
let inflight: Promise<{ members: CrewRosterMember[]; viewerIsFamilyMember: boolean }> | null = null;

/**
 * Clear the shared in-flight roster cache. Call this after any action that
 * changes crew membership (add/remove a child, claim a link code) so every
 * toolbar variant and station re-fetches on next render instead of serving
 * the stale module-level cache.
 */
export function invalidateCrewRoster(): void {
  inflight = null;
}

function fetchRoster(): Promise<{ members: CrewRosterMember[]; viewerIsFamilyMember: boolean }> {
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch("/api/crew/members");
        if (!res.ok) return { members: [], viewerIsFamilyMember: false };
        const json = await res.json();
        return {
          members: Array.isArray(json.members) ? (json.members as CrewRosterMember[]) : [],
          viewerIsFamilyMember: json.viewer_is_family_member === true,
        };
      } catch {
        // Unreachable / signed out: treat as no linked children. The
        // surfaces that need data show their own honest states.
        return { members: [], viewerIsFamilyMember: false };
      }
    })();
  }
  return inflight;
}

/** The pilot's linked children (crew members). Shared + cached per page load. */
export function useCrewRoster(): RosterState {
  const [state, setState] = useState<RosterState>({ members: [], loading: true, viewerIsFamilyMember: false });
  useEffect(() => {
    let alive = true;
    fetchRoster().then(({ members, viewerIsFamilyMember }) => {
      if (alive) setState({ members, loading: false, viewerIsFamilyMember });
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
