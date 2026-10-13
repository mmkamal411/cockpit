# Crystal worker

Cloudflare Worker that powers the Cockpit app's Crystal/Fireball chat
(`https://crystal.mehedikamal.workers.dev`).

- `src/index.ts` — worker entry: `/chat`, `/quiz`, `/health` routes, shared-secret
  auth, Workers AI calls.
- `src/contract.ts` — canonical app ↔ worker chat contract (copied from
  `src/lib/chat/contract.ts`; keep in sync).
- `wrangler.toml` — worker config. The `AI` binding and the
  `CRYSTAL_WORKER_SECRET` secret are set on the deployed worker; `wrangler
  secret put` / dashboard for the secret — never hardcode it.

## Deploy

```sh
cd workers/crystal
npm install
npx esbuild src/index.ts --bundle --format=esm --platform=neutral --outfile=dist/index.js
# then upload dist/index.js via the Cloudflare API script-upload endpoint
# (PUT /accounts/{id}/workers/scripts/crystal, multipart with metadata:
#  main_module=index.js, ai binding, MODEL var, compatibility_date 2026-09-01)
```

Secrets (`CRYSTAL_WORKER_SECRET`) persist across script uploads — the upload
only replaces code + plain vars.

## Prompt changes

The system prompts carry an `IDENTITY_AND_APP` block: the model must know
that "Muse" was Fireball's old name, and must know the app's actual features
(tabs, stations, Crew/School applets). Added 2026-10-13 after the pilot caught
Crystal deflecting on both ("I don't have information about a More tab...",
"I don't see any information about a 'muse'"). Never remove this block —
without it the model deflects on identity/feature questions.
