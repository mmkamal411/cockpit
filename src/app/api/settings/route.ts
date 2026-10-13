import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import {
  AllSettings,
  DEFAULT_SETTINGS,
  SETTINGS_NAMESPACES,
  SettingsNamespace,
  mergeSettings,
  sanitizeNamespace,
} from "@/lib/pilot-settings";

function isNamespace(v: unknown): v is SettingsNamespace {
  return typeof v === "string" && (SETTINGS_NAMESPACES as string[]).includes(v);
}

/**
 * GET /api/settings
 * Returns every settings namespace, merged over defaults, so a missing row
 * is never a blank screen — just the out-of-the-box values.
 */
export async function GET() {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("pilot_settings")
      .select("namespace, settings")
      .eq("pilot_id", pilotId);
    if (error) throw error;

    const out = { ...DEFAULT_SETTINGS } as AllSettings;
    for (const row of data ?? []) {
      const ns = row.namespace as SettingsNamespace;
      if (!isNamespace(ns)) continue;
      out[ns] = mergeSettings(
        DEFAULT_SETTINGS[ns] as Record<string, unknown>,
        row.settings,
      ) as never;
    }
    return NextResponse.json({ settings: out });
  } catch (e) {
    console.error(
      JSON.stringify({
        route: "GET /api/settings",
        operation: "load settings",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return NextResponse.json(
      { error: "Couldn't load your settings right now." },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/settings
 * Body: { namespace: "alerts" | ..., settings: { ...partial } }
 * Merges the partial update over the stored row (unknown keys dropped),
 * so clients can save one field at a time.
 */
export async function PUT(req: Request) {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const body = await req.json().catch(() => ({}));
    if (!isNamespace(body.namespace)) {
      return NextResponse.json(
        { error: "Tell us which settings section to save." },
        { status: 400 },
      );
    }
    const ns = body.namespace as SettingsNamespace;
    const supabase = await createClient();

    const { data: existing } = (await supabase
      .from("pilot_settings")
      .select("settings")
      .eq("pilot_id", pilotId)
      .eq("namespace", ns)
      .maybeSingle()) as { data: { settings: Record<string, unknown> } | null };

    const sanitized = sanitizeNamespace(ns, body.settings ?? {});
    const merged = mergeSettings(
      mergeSettings(
        DEFAULT_SETTINGS[ns] as Record<string, unknown>,
        existing?.settings ?? {},
      ),
      sanitized as Record<string, unknown>,
    );

    const { error } = await supabase.from("pilot_settings").upsert(
      {
        pilot_id: pilotId,
        namespace: ns,
        settings: merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "pilot_id,namespace" },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true, settings: merged });
  } catch (e) {
    console.error(
      JSON.stringify({
        route: "PUT /api/settings",
        operation: "save settings",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return NextResponse.json(
      { error: "Couldn't save that setting right now. Try again." },
      { status: 500 },
    );
  }
}
