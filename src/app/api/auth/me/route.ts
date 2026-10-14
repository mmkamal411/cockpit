import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicConfig } from "@/lib/supabase/config";

/**
 * Return the current signed-in user's email (or 401 if not signed in).
 * Used by the Settings section to show who is logged in.
 */
export async function GET(request: NextRequest) {
  const { url, key } = supabasePublicConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll() {
        // Read-only route; no cookies to set.
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  return NextResponse.json({ email: data.user.email ?? null });
}
