import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext Cloudflare adapter config.
 *
 * Cookie behavior (2026-10-12 lesson, verified): the adapter does NOT strip
 * Set-Cookie headers — the default config preserves them end to end. The
 * Workers cookie bug was app-side only: in route handlers, never rely on
 * next/headers cookies().set() propagating to a freshly constructed
 * NextResponse (silently dropped on Workers). The auth callback
 * (src/app/auth/callback/route.ts) already captures cookies in a local
 * array and sets them explicitly on the redirect response; the Supabase
 * middleware sets cookies on its response object, which propagates
 * correctly. No adapter-level cookie workarounds are needed here.
 */
export default defineCloudflareConfig({});
