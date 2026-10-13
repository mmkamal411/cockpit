import { createClient } from "@/lib/supabase/server";

/**
 * Returns the current pilot's ID (== auth.users.id) or null when not signed in.
 * Every crew API route calls this first — no pilot, no data.
 */
export async function getPilotId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Error shape every crew API route returns on auth failure. */
export function unauthorized() {
  return { error: "Sign in to manage your crew." };
}
