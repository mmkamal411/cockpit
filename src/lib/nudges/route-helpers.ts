/**
 * Shared helpers for the /api/nudges routes.
 *
 * - jsonError: structured { error } responses — never raw 500s.
 * - requirePilot: pilot-scoped Supabase client via the session cookie,
 *   plus the pilot's timezone for quiet-hours math.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Structured error JSON. Message is plain-English, never a stack trace. */
export function jsonError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export interface PilotContext {
  pilotId: string;
  supabase: SupabaseClient;
  timezone: string;
}

/**
 * Resolve the signed-in pilot. Returns a { response } error to return
 * directly when auth fails — keeps every route's happy path flat.
 */
export async function requirePilot(): Promise<
  { ok: true; ctx: PilotContext } | { ok: false; response: NextResponse }
> {
  let supabase: SupabaseClient;
  try {
    supabase = await createClient();
  } catch {
    return { ok: false, response: jsonError("Could not reach the database. Try again in a moment.", 503) };
  }

  let userId: string;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { ok: false, response: jsonError("Sign in to manage your nudges.", 401) };
    }
    userId = data.user.id;
  } catch {
    return { ok: false, response: jsonError("Could not verify your sign-in. Try again.", 500) };
  }

  try {
    const { data: pilot, error } = await supabase
      .from("pilots")
      .select("id,timezone")
      .eq("id", userId)
      .maybeSingle();
    if (error || !pilot) {
      return { ok: false, response: jsonError("Pilot profile not found.", 404) };
    }
    return {
      ok: true,
      ctx: {
        pilotId: pilot.id as string,
        supabase,
        timezone: (pilot.timezone as string | null) ?? "UTC",
      },
    };
  } catch {
    return { ok: false, response: jsonError("Could not load your pilot profile. Try again.", 500) };
  }
}

/** Parse a JSON body, returning null (not throwing) when it's unreadable. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** ISO-8601 timestamp in the future, or null. */
export function parseFutureIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return null;
  return d.toISOString();
}
