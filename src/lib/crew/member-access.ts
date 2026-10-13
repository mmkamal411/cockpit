import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verify the pilot owns the crew member. Returns the member's id on success,
 * or null when the member is missing or belongs to another pilot.
 * Routes return 404 on null so callers can't probe other pilots' crew.
 */
export async function getOwnedCrewMemberId(
  supabase: SupabaseClient,
  crewMemberId: string,
  pilotId: string,
): Promise<string | null> {
  const { data: member } = await supabase
    .from("crew_members")
    .select("id, pilot_id")
    .eq("id", crewMemberId)
    .single();
  if (!member || member.pilot_id !== pilotId) return null;
  return member.id;
}
