# Station Deck Showcase — Revert Plan

Branch: `redesign/station-deck-showcase`
Flag: `STATION_DECK_VARIANT` in `src/lib/feature-flags.ts`

## What this branch does
Replaces the "More" list with a station-deck showcase. Three variants, one flag:
- `legacy` — original More list (default; zero behavior change)
- `bays` — five life-domain bays, select → preview panel → open button
- `ecam` — category keys + synoptic area, phase-aware LED emphasis
- `grid` — dense adaptive grid, bay filter chips

The `openApplet("more")` bus call is untouched. The toolbar, applet host, and
all 11 real applets are unchanged. A minimal Settings placeholder applet was
added so the deck's pinned Settings footer can't crash the host.

## Tier 1 revert — flag flip (~3 min)
1. In `src/lib/feature-flags.ts`, set `STATION_DECK_VARIANT = "legacy"`.
2. Commit + push. The Git-connected Pages project redeploys automatically.
3. Verify `/` → More key shows the original list.

This is the expected revert path. Nothing else on the branch affects it —
the flag is independent of `TOOLBAR_VARIANT` (no coupled fate).

## Tier 2 revert — abandon the branch
1. `git checkout main`
2. `git branch -D redesign/station-deck-showcase` (local)
3. `git push origin --delete redesign/station-deck-showcase` (remote)

Main never merged this branch, so there is nothing to unpick.

## Verification checklist (per variant)
- [ ] More key opens the deck; back/close returns cleanly
- [ ] Tap station = select only (nothing opens)
- [ ] Preview panel pinned above toolbar, never scrolls away
- [ ] "Open {Station} →" button (≥48px) opens the right applet
- [ ] Seedling "Notify me" flips to "You're on the list ✓" locally
- [ ] "Hail a station" search filters correctly
- [ ] Settings footer opens the Settings placeholder
- [ ] No console errors; no new network calls on deck mount
- [ ] Mobile 390px: no overlap, no horizontal scroll
