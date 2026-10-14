import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { logAdminAction } from "@/lib/admin/audit";
import { adminRoute, jsonError, redactSecrets } from "@/lib/admin/routeHandler";
import { getPilot } from "@/lib/admin/pilots";

/** Admin data must never be statically cached. */

/**
 * POST /api/admin/users/[id]/unsuspend
 * Body: { note?: string } (optional). Clears pilots.suspended and
 * audit-logs the before/after snapshot.
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

  let note = "";
  try {
    const body = (await req.json()) as { note?: unknown };
    note = typeof body.note === "string" ? body.note.trim() : "";
  } catch {
    // Body is optional for unsuspend — an empty body is fine.
  }

  const before = redactSecrets({ pilot: { ...pilot, suspended: pilot.suspended ?? false } });

  const { error } = await admin.from("pilots").update({ suspended: false }).eq("id", id);
  if (error) throw new Error(error.message);

  const after = { id, suspended: false };

  await logAdminAction(admin, {
    actorEmail: adminEmail,
    action: "user.unsuspend",
    targetType: "pilot",
    targetId: id,
    before,
    after,
    metadata: note ? { note } : {},
  });

  return NextResponse.json({ id, suspended: false });
});
