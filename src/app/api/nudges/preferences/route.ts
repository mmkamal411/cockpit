/**
 * GET /api/nudges/preferences — the pilot's nudge tuning.
 * PATCH /api/nudges/preferences — update it.
 *
 * PATCH body (all optional):
 *   { categories: { bill: false },        // per-category on/off
 *     min_score: 60,                       // sensitivity — swallows quieter nudges
 *     quiet_hours_start: "22:00",          // HH:MM pilot-local
 *     quiet_hours_end: "07:00",
 *     breakthrough_allowed: false }        // urgent tier may wake the pilot
 *
 * Unknown category keys are rejected; HH:MM is validated; min_score is
 * clamped to 0–150. Absent preferences row → defaults (all categories on).
 */
import { NextRequest, NextResponse } from "next/server";
import {
  NUDGE_CATEGORIES,
  getPreferences,
  parseHHMM,
  type NudgeCategory,
  type NudgePreferences,
} from "@/lib/nudges/engine";
import { jsonError, readJson, requirePilot } from "@/lib/nudges/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requirePilot();
    if (!auth.ok) return auth.response;
    const prefs = await getPreferences(auth.ctx.supabase, auth.ctx.pilotId);
    return NextResponse.json({ preferences: prefs, categories: NUDGE_CATEGORIES });
  } catch {
    return jsonError("Could not load your nudge preferences. Try again.", 500);
  }
}

function validatePatch(
  body: Record<string, unknown>,
): { ok: true; patch: Partial<NudgePreferences> } | { ok: false; error: string } {
  const patch: Partial<NudgePreferences> = {};

  if (body.categories !== undefined) {
    if (!body.categories || typeof body.categories !== "object" || Array.isArray(body.categories)) {
      return { ok: false, error: "categories must be an object like { bill: false }." };
    }
    const cats: Partial<Record<NudgeCategory, boolean>> = {};
    for (const [key, value] of Object.entries(body.categories as Record<string, unknown>)) {
      if (!(NUDGE_CATEGORIES as readonly string[]).includes(key)) {
        return { ok: false, error: `Unknown category "${key}".` };
      }
      if (typeof value !== "boolean") {
        return { ok: false, error: `Category "${key}" must be true or false.` };
      }
      cats[key as NudgeCategory] = value;
    }
    patch.categories = cats;
  }

  if (body.min_score !== undefined) {
    const n = Number(body.min_score);
    if (!Number.isFinite(n)) return { ok: false, error: "min_score must be a number." };
    patch.min_score = Math.min(150, Math.max(0, Math.round(n)));
  }

  for (const field of ["quiet_hours_start", "quiet_hours_end"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "string" || parseHHMM(body[field] as string) == null) {
        return { ok: false, error: `${field} must be HH:MM, like "22:00".` };
      }
      patch[field] = (body[field] as string).trim();
    }
  }

  if (body.breakthrough_allowed !== undefined) {
    if (typeof body.breakthrough_allowed !== "boolean") {
      return { ok: false, error: "breakthrough_allowed must be true or false." };
    }
    patch.breakthrough_allowed = body.breakthrough_allowed;
  }

  return { ok: true, patch };
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requirePilot();
    if (!auth.ok) return auth.response;
    const { pilotId, supabase } = auth.ctx;

    const body = await readJson(req);
    if (!body) return jsonError("Request body must be JSON.", 400);
    const valid = validatePatch(body);
    if (!valid.ok) return jsonError(valid.error, 422);
    if (Object.keys(valid.patch).length === 0) {
      return jsonError("Nothing to update — send at least one preference.", 400);
    }

    const current = await getPreferences(supabase, pilotId);
    const merged: NudgePreferences = {
      pilot_id: pilotId,
      categories: { ...current.categories, ...(valid.patch.categories ?? {}) },
      min_score: valid.patch.min_score ?? current.min_score,
      quiet_hours_start: valid.patch.quiet_hours_start ?? current.quiet_hours_start,
      quiet_hours_end: valid.patch.quiet_hours_end ?? current.quiet_hours_end,
      breakthrough_allowed: valid.patch.breakthrough_allowed ?? current.breakthrough_allowed,
    };

    const { error } = await supabase.from("nudge_preferences").upsert(
      {
        pilot_id: pilotId,
        categories: merged.categories,
        min_score: merged.min_score,
        quiet_hours_start: merged.quiet_hours_start,
        quiet_hours_end: merged.quiet_hours_end,
        breakthrough_allowed: merged.breakthrough_allowed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "pilot_id" },
    );
    if (error) return jsonError("Could not save your preferences. Try again.", 500);

    return NextResponse.json({ preferences: merged });
  } catch {
    return jsonError("Could not save your preferences. Try again.", 500);
  }
}
