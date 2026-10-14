# Cockpit deploy pipeline

Target: **https://cockpit-10c.pages.dev** (canonical staging URL, confirmed by Meheldi 2026-10-13).

## Deploy command

From the repo root:

```bash
python3 deploy/deploy-staging.py
```

Pipeline steps:

1. `npm run build` — Next.js production build (fails loudly on missing
   `NEXT_PUBLIC_*` build vars; they are read from the environment or
   `.env.local` and baked into the bundle).
2. `npx opennextjs-cloudflare build` — adapts the build to the Cloudflare
   Workers runtime (`.open-next/`).
3. `deploy/assemble-pages-deploy.py` — assembles `.pages-deploy/` from the
   fresh build and writes `_routes.json` so **Pages serves `/videos/*` and
   `/_next/static/*` directly** instead of routing them through the worker
   (without this, the OpenNext worker 404s every static asset — lesson from
   pookie-app 2026-10-11; `/videos/*` added 2026-10-12 for the space-loop
   backgrounds).
4. `wrangler pages deploy .pages-deploy --project-name cockpit --branch=main`
   — deploys to production (`--branch=main` must match the project's
   production branch in the dashboard).
5. `deploy/smoke-test-staging.py` — asserts `/` (200/3xx), `/login` (200),
   `/auth/callback` (307), `/videos/vista-planets-1.mp4` (200 + `video/*`
   content-type), and a `/​_next/static/*` asset (200). Any failure exits
   non-zero and the deploy must not be announced.

Variant for local iteration only: `python3 deploy/deploy-staging.py
--skip-build` reuses the existing `.open-next/` but still refuses to
deploy if sources are newer than the build output.

Cloudflare API auth comes from the Secure Vault entry `custom.cloudflare`
(an API token surrogate) — never from the repo.

## One-time dashboard setup (Mehedi)

**Do this before the first deploy — the deploy script does not create the
project.**

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Upload assets** (direct upload, not Git-connected). Name the project
   **`cockpit`**. This serves the canonical staging URL
   `https://cockpit-10c.pages.dev` (do NOT use `cockpit.pages.dev` — that is a
   different/stale URL).
2. Project **Settings** → **Environment variables** → **Production**:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://hwnesewathbnfvoxtbqh.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` =
     `sb_publishable_-gpFmkywUHJ9G3Yg2tPueQ_0J4DjqL0`
   - `SUPABASE_SERVICE_ROLE_KEY` = the service_role key (secret — from the
     Secure Vault; **never in the repo**, not even in `wrangler.jsonc`).
   - Confirm **Production branch** is `main` (the deploy script passes
     `--branch=main`; if the project's production branch is different,
     update the flag in `deploy/deploy-staging.py`).

Local dev: copy `.env.example` to `.env.local` and fill in
`SUPABASE_SERVICE_ROLE_KEY` from the Secure Vault for anything that needs
it. `.env.local` is gitignored.

## Cookie behavior note

OpenNext's default adapter config preserves `Set-Cookie` headers end to
end (verified — no stripping in `@opennextjs/cloudflare` 1.20.10). The
Workers cookie pitfall was app-side only and is already fixed:
`src/app/auth/callback/route.ts` captures cookies in a local array and
sets them explicitly on the redirect response instead of relying on
`next/headers` propagation. No adapter-level workaround is needed in
`open-next.config.ts`.
