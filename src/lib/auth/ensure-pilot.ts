import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ensurePilot — idempotent lazy provisioning of the public.pilots row.
 *
 * Every pilot_id-keyed table has a foreign key to pilots(id), so a missing
 * pilots row breaks ALL writes (chat threads, todos, bills, ...) with an
 * FK violation. The DB trigger from migration 034 provisions the row at
 * signup; this is the belt-and-braces path for pre-trigger users and for
 * any signup where the trigger hadn't run yet.
 *
 * Contract:
 * - success  -> { ok: true }  (row exists; created or already there)
 * - failure  -> { ok: false, message } with a PLAIN-ENGLISH message that
 *   includes the recovery path. Callers must surface the message LOUDLY
 *   (never a silent 500 loop, never a lying success).
 */
export async function ensurePilot(
  supabase: SupabaseClient,
  pilotId: string,
  email?: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const row: { id: string; email?: string | null } = { id: pilotId };
    const clean = email?.trim().toLowerCase();
    if (clean) row.email = clean;
    const { error } = await supabase.from("pilots").upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    // Loud server-side log — the pilot-facing message stays plain English.
    console.error(
      JSON.stringify({
        route: "ensurePilot",
        operation: "upsert pilots",
        pilot_id: pilotId,
        error: e instanceof Error ? e.message : String(e),
        timestamp: new Date().toISOString(),
      }),
    );
    return {
      ok: false,
      message:
        "Your account isn't fully set up yet. Sign out and sign back in — that usually finishes the setup.",
    };
  }
}
