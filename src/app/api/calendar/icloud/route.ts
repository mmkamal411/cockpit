import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/token-crypto";
import { validateIcloudCredentials } from "@/lib/calendar/providers/icloud";

/**
 * POST /api/calendar/icloud
 * Body: { appleId: string, appPassword: string }
 *
 * Connects iCloud Calendar via CalDAV. The app-specific password (generated
 * at appleid.apple.com) is validated against iCloud, then stored encrypted.
 * We never see or store the Apple ID password.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in first, then connect your calendar." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const appleId = (body.appleId as string ?? "").trim();
    const appPassword = (body.appPassword as string ?? "").trim();
    if (!appleId || !appPassword) {
      return NextResponse.json(
        { error: "Enter your Apple ID and an app-specific password." },
        { status: 400 },
      );
    }

    // Validate against iCloud before storing anything.
    try {
      await validateIcloudCredentials(appleId, appPassword);
    } catch {
      return NextResponse.json(
        {
          error:
            "Couldn't sign in to iCloud. Check your Apple ID and that the app-specific password is correct (generate a new one at appleid.apple.com if needed).",
        },
        { status: 401 },
      );
    }

    const secretEnc = await encryptToken(appPassword);
    const { error: connErr } = await supabase.from("calendar_connections").upsert(
      {
        pilot_id: user.id,
        provider: "icloud",
        provider_account_email: appleId,
        refresh_token_enc: secretEnc,
        status: "active",
        last_synced_at: null,
      },
      { onConflict: "pilot_id,provider,provider_account_email" },
    );
    if (connErr) throw connErr;

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Couldn't connect iCloud Calendar right now." },
      { status: 500 },
    );
  }
}
