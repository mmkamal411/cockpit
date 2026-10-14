/**
 * Single source of truth for the public Supabase connection values.
 *
 * NEXT_PUBLIC_* vars are inlined by Next at build time; on the Cloudflare
 * Workers runtime the adapter's populateProcessEnv() also copies the Pages
 * project's env vars into process.env. The hardcoded fallbacks below are a
 * last-resort safety net (public values by design — safe to ship in the
 * bundle). Never put secrets here.
 */
const FALLBACK_URL = "https://hwnesewathbnfvoxtbqh.supabase.co";
const FALLBACK_KEY = "sb_publishable_-gpFmkywUHJ9G3Yg2tPueQ_0J4DjqL0";

export function supabasePublicConfig(): { url: string; key: string } {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || FALLBACK_KEY,
  };
}

/**
 * fetch with a timeout. Supabase-js uses global fetch with no timeout by
 * default — a slow (not down) Supabase would hang every request until the
 * Workers runtime kills it (1101/500). 10s bounds every DB call.
 */
export function fetchWithTimeout(ms = 10_000): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(input, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
  };
}
