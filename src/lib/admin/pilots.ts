import type { SupabaseClient, User } from "@supabase/supabase-js";

export interface PilotRow {
  id: string;
  display_name: string | null;
  timezone: string | null;
  created_at: string;
  /** Null when the 004_admin_suspend migration has not been applied yet. */
  suspended: boolean | null;
}

const PILOT_COLUMNS = "id, display_name, timezone, created_at, suspended";
const PILOT_COLUMNS_NO_SUSPEND = "id, display_name, timezone, created_at";

function isUnknownColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(error.message ?? "");
}

/**
 * Fetch one pilot row, tolerating a DB where the `suspended` column
 * (004_admin_suspend.sql) has not been applied yet.
 */
export async function getPilot(admin: SupabaseClient, id: string): Promise<PilotRow | null> {
  const first = await admin
    .from("pilots")
    .select(PILOT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (first.error) {
    if (isUnknownColumnError(first.error)) {
      const retry = await admin
        .from("pilots")
        .select(PILOT_COLUMNS_NO_SUSPEND)
        .eq("id", id)
        .maybeSingle();
      if (retry.error) throw new Error(retry.error.message);
      return retry.data ? { ...(retry.data as Omit<PilotRow, "suspended">), suspended: null } : null;
    }
    throw new Error(first.error.message);
  }
  return (first.data as PilotRow | null) ?? null;
}

/** Fetch every pilot row (admin-scale table; tolerates missing `suspended`). */
export async function listPilots(admin: SupabaseClient): Promise<PilotRow[]> {
  const first = await admin.from("pilots").select(PILOT_COLUMNS);
  if (first.error) {
    if (!isUnknownColumnError(first.error)) throw new Error(first.error.message);
    const retry = await admin.from("pilots").select(PILOT_COLUMNS_NO_SUSPEND);
    if (retry.error) throw new Error(retry.error.message);
    return ((retry.data ?? []) as Omit<PilotRow, "suspended">[]).map((row) => ({
      ...row,
      suspended: null,
    }));
  }
  return (first.data ?? []) as PilotRow[];
}

/**
 * List every auth user via the admin API. Paginates through all pages
 * (1k per page, sanity-capped at 100 pages).
 */
export async function listAllAuthUsers(admin: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  const perPage = 1000;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < perPage) break;
  }
  return users;
}
