import { headers } from "next/headers";

/**
 * Server-side fetch helper for the parallel-built /api/admin/* routes.
 *
 * Builds an absolute same-origin URL from the incoming request headers and
 * forwards the request cookies so the API route sees the same session.
 * `cache: "no-store"` — admin data is always live.
 */

export async function adminApiUrl(path: string): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base =
    host != null && host.length > 0
      ? `${proto}://${host}`
      : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  return `${base}${path}`;
}

/** Fetch JSON from an admin API route. Throws a plain-English Error on failure. */
export async function adminGet<T>(path: string): Promise<T> {
  const h = await headers();
  const res = await fetch(await adminApiUrl(path), {
    headers: {
      Accept: "application/json",
      ...(h.get("cookie") != null ? { cookie: h.get("cookie")! } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") detail = body.error;
    } catch {
      // keep the status-line fallback
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

/**
 * Safe wrapper: never throws. Returns { data } on success or { error }
 * with a plain-English message — admin pages render the error state
 * instead of a blank page when the backend isn't up yet.
 */
export async function adminGetSafe<T>(
  path: string,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const data = await adminGet<T>(path);
    return { data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return { data: null, error: message };
  }
}
