# Toolbar Redesign — Revert Plan

**Status:** Phase 1 (design) complete. Implementation not started — no branch exists yet.
**Branch (when created):** `redesign/toolbar-cockpit`
**Feature flag:** `TOOLBAR_V2` in `src/lib/feature-flags.ts` (code constant, NOT an env var)

---

## Why a code flag, not an env var

On Cloudflare Pages, `NEXT_PUBLIC_*` values are inlined at build time — flipping an env var still requires a full rebuild + redeploy, so there is **no speed advantage** over a code constant. A code flag is versioned, reviewable, diffable, and reverts with `git revert`. (Lesson 2026-10-12: staging builds don't reliably inherit Pages env vars anyway.)

---

## File choreography (first commits on the branch)

1. `git checkout -b redesign/toolbar-cockpit`
2. `git mv src/components/toolbar.tsx src/components/toolbar-legacy.tsx`
3. Rename `export function Toolbar()` → `export function ToolbarLegacy()` in the moved file
4. Commit each step separately (keeps `git log --follow` useful, revert diff readable)
5. Add `src/lib/feature-flags.ts` with `export const TOOLBAR_V2 = true`
6. In `cockpit-shell.tsx` (~line 107–113): `{TOOLBAR_V2 ? <Toolbar /> : <ToolbarLegacy />}`
7. Write the branch README (see below) before any design work

---

## Hard constraints the redesign must preserve

| # | Contract | Source |
|---|---|---|
| C1 | Orb keeps `id="toolbar-crystal-orb"` — the SoothingOrb drift controller re-finds it via MutationObserver; renaming it silently kills the drift | `toolbar.tsx:100`, `soothing-orb.tsx:22` |
| C2 | Never set inline `translate` on the orb; drift uses independent CSS `translate`, hover uses `transform: scale` — they must coexist | `soothing-orb.tsx:120–140` |
| C3 | `openApplet("today"\|"crystal"\|"progress"\|"more")` + `closeAllApplets()` — exact signatures, synchronous emits | `applet-bus.ts:80–96` |
| C4 | Station → applet-id mapping is load-bearing; orb + Crystal station both open `"crystal"` (bus dedupes — don't add a second) | `applet-bus.ts:114–120` |
| C5 | Home = `closeAllApplets()` THEN `router.push("/home")` — order matters | `toolbar.tsx:64–68` |
| C6 | Toolbar z-index stays at 80 — under applet overlays (90) and transit veil (120). Never raise it. | `toolbar.tsx:76`, `applet-host.tsx:308,367` |
| C7 | Keep `pb-[max(14px,env(safe-area-inset-bottom))]` exactly — iOS home-indicator clearance | `toolbar.tsx:76` |
| C8 | `<style>{X_CSS}</style>` pattern is idiomatic here — no need to migrate to CSS modules | 5 components use it |
| C9 | Toolbar mounts only inside CockpitShell (`inShip`) — don't move it outside or drift coupling breaks | `cockpit-shell.tsx:107–113` |
| C10 | Wrapper stays `pointer-events-none`, bar stays `pointer-events-auto` — background stays tappable | `toolbar.tsx:76,78` |

---

## Revert — Tier 1: instant flag flip (~3 min to live)

Use when the new toolbar looks broken but the app is fine.

```bash
git checkout redesign/toolbar-cockpit   # or main, if already merged
# set TOOLBAR_V2 = false in src/lib/feature-flags.ts
git commit -am "revert: flag toolbar back to legacy (TOOLBAR_V2=false)"
git push origin redesign/toolbar-cockpit
# If merged to main: cherry-pick or fast-forward the flag commit to main;
# Cloudflare Pages Git integration auto-deploys main.
```

---

## Revert — Tier 2: full removal

Use when the flag flip is insufficient, or the branch was never merged.

```bash
git checkout main
git revert <merge-commit-of-redesign> -m 1
git push origin main   # auto-deploys via Cloudflare Pages Git integration
```

This restores `toolbar.tsx`, deletes `toolbar-legacy.tsx` + the flag file.

---

## Deployment rules

- **Staging only** until Meheldi verifies in his own browser on mobile.
- The branch deploys via the normal pipeline (push → Cloudflare Pages builds `main`; for the feature branch, open a draft PR or use `deploy/deploy-staging.py`).
- **Push every commit** to `mmkamal411/cockpit` on the feature branch.
- Never delete `toolbar-legacy.tsx` until the redesign is signed off.

---

## Browser-verification checklist (Meheldi's TEST BEFORE YOU CLAIM rule)

Before claiming the redesign is done, in a real browser on staging:

- [ ] Load staging, tap each of the 5 stations — correct applet opens each time
- [ ] Open, minimize, and close an applet — toolbar state stays coherent
- [ ] Orb drift resumes after navigation (SoothingOrb coupling intact)
- [ ] iOS Safari: bar clears the home indicator (safe-area screenshot)
- [ ] `prefers-reduced-motion`: orb breathing + all new motion stops
- [ ] 320px width: no overflow, no clipped labels
- [ ] 430px width: bar doesn't look adrift
- [ ] Open any applet: toolbar is fully covered (z-index contract holds)
- [ ] Labels readable over the brightest space video background
- [ ] Flip `TOOLBAR_V2=false`, redeploy, confirm legacy toolbar returns pixel-identical

---

## Top 5 implementation risks

1. **Orb drift coupling** — renamed id or inline `translate` silently kills SoothingOrb. Mitigation: dev-only `console.warn` when zero orbs match after 5s.
2. **Active-indicator desync** — bus emits are synchronous; latch to last non-null `open.id` in a `useRef`, never drive UI directly off `state.open`.
3. **Safe-area regression on iOS** — keep the exact padding expression; verify on a real iPhone.
4. **Backdrop-blur performance on low-end Android** — cap glows to the active station; prefer `box-shadow` over `filter: blur()`.
5. **Z-index wars** — no toolbar element may create a stacking context above `z-[80]`.

---

*Phase 1 design report: see coordinator's recommendation (parent agent).*
*Design guardrails: docs/COCKPIT-PRODUCT-ROADMAP.md (platform layer) + design systems reviewer's token table.*
