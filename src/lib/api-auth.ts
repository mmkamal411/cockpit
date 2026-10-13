import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Pilot auth for API routes. RLS on the tables does the row-level scoping;
 * this just proves the request belongs to a signed-in pilot.
 *
 * Returns { supabase, user } or a 401 NextResponse. Callers do:
 *   const auth = await requirePilot();
 *   if (auth instanceof NextResponse) return auth;
 *   const { supabase, user } = auth;
 */
export async function requirePilot() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in to continue." },
        { status: 401 },
      );
    }
    return { supabase, user };
  } catch {
    return NextResponse.json(
      { error: "Something went wrong signing you in. Try again." },
      { status: 500 },
    );
  }
}

/** Plain-English 500 for unexpected failures. Never leaks internals. */
export function serverError() {
  return NextResponse.json(
    { error: "Something went wrong on our end. Try again in a moment." },
    { status: 500 },
  );
}
