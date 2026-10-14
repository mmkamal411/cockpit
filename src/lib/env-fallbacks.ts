/**
 * env-fallbacks.ts — hardcoded fallbacks for PUBLIC (non-secret) env vars.
 *
 * Direct-upload deployments to Cloudflare Pages do not receive environment
 * variables at runtime. The hardcoded fallbacks below are a last-resort
 * safety net for values that are public by design.
 *
 * SECURITY: Never put secrets here. Secrets (API keys, client secrets,
 * encryption keys) must come from the build environment (.env.local,
 * gitignored) so they are baked into the server bundle at build time,
 * never committed to git. See deploy/deploy-staging.py REQUIRED_BUILD_ENV.
 *
 * Pattern follows src/lib/supabase/config.ts (FALLBACK_URL/FALLBACK_KEY).
 */

// Public by design: the Google OAuth client ID is exposed in the OAuth
// redirect URL and in the client-side consent flow. Safe to ship in the bundle.
const FALLBACK_GOOGLE_CALENDAR_CLIENT_ID =
  "650925920430-h04fp79fv5hkjhvk173hl62v4n3ptp1p.apps.googleusercontent.com";

// Public by design: admin email allowlist. Not a secret — it's an identifier.
const FALLBACK_ADMIN_EMAILS = "mehedikamal@gmail.com";

export function googleCalendarClientId(): string {
  return (
    process.env.GOOGLE_CALENDAR_CLIENT_ID || FALLBACK_GOOGLE_CALENDAR_CLIENT_ID
  );
}

export function adminEmails(): string {
  return process.env.ADMIN_EMAILS || FALLBACK_ADMIN_EMAILS;
}
