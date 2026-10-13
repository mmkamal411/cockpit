import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { logAdminAction } from "@/lib/admin/audit";
import { adminRoute, jsonError, redactSecrets } from "@/lib/admin/routeHandler";
import { getPilot } from "@/lib/admin/pilots";

/** Admin data must never be statically cached. */

/**
 * POST /api/admin/users/[id]/suspend
 * Body: { reason: string } (required). Sets pilots.suspended = true and
 * audit-logs the before/after snapshot.
 *
 * NOTE: enforcement (refusing sign-in for suspended pilots) lives in app
 * code and is not part of this API — this route only flips the flag.
 */
export const POST = adminRoute<{ id: string }>(async (adminEmail, req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const admin = createAdminClient();

  const pilot = await getPilot(admin, id);
  if (!pilot) return jsonError("User not found", 404);
  if (pilot.suspended === null) {
    return jsonError(
      "The pilots.suspended column does not exist yet — apply supabase/migrations/004_admin_suspend.sql first.",
      500,
    );
  }

  let body: { reason?: unknown };
  try {
    body = (await req.json()) as { reason?: unknown };
  } catch {
    return jsonError("Request body must be JSON: { reason: \"...\" }.", 400);
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return jsonError("A reason is required to suspend a user.", 400);

  const before = redactSecrets({ pilot: { ...pilot, suspended: pilot.suspended ?? false } });

  const { error } = await admin.from("pilots").update({ suspended: true }).eq("id", id);
  if (error) throw new Error(error.message);

  const after = { id, suspended: true };

  await logAdminAction(admin, {
    actorEmail: adminEmail,
    action: "user.suspend",
    targetType: "pilot",
    targetId: id,
    before,
    after,
    metadata: { reason },
  });

  return NextResponse.json({ id, suspended: true });
});
