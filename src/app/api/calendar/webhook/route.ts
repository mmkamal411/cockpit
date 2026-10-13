import { NextResponse } from "next/server";

/**
 * POST /api/calendar/webhook
 * Google Calendar push-notification endpoint.
 * TODO: channel registry + token verification when push subscriptions are wired (Phase 1.1).
 */
export async function POST(req: Request) {
  const channelId = req.headers.get("x-goog-channel-id");
  const resourceState = req.headers.get("x-goog-resource-state");
  if (!channelId) {
    return NextResponse.json({ error: "Missing channel." }, { status: 400 });
  }
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true });
  }
  console.log(`[calendar webhook] change on channel ${channelId} (${resourceState})`);
  return NextResponse.json({ ok: true });
}
