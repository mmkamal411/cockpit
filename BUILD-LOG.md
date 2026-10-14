# Crystal v2 — Build Log

**Project:** Complete rebuild of Cockpit as "Crystal" (StarCraft-style cockpit theme)
**Source:** Copy of ~/workspace/cockpit (initial commit 91673e6)
**Started:** 2026-10-14 ~02:15 EDT
**Coordinator:** Build Coordinator (subagent session 3ebed03b)

## Teams

| Team | Branch | Scope | Status |
|------|--------|-------|--------|
| Theme | feature/v2-theme | Rebrand Cockpit→Crystal; StarCraft theme (deep space navy, cyan/mint teal, frosted glass, neon) | RUNNING (agent 418ec7a5) |
| Landing | feature/v2-landing | Pre-login landing page, hero video, auth, legal pages, sales chat | RUNNING (agent 75791d69) |
| Mascot | feature/v2-mascot | Crystal mascot (snow-white fluffy, neon accents, animated moods) | RUNNING (agent 76dd3ba4) |
| Toolbar | feature/v2-toolbar | StarCraft command center toolbar (ability grid, radar, alerts, sounds) | RUNNING (agent 96e06a33) |

## Progress

### 2026-10-14 02:15 EDT — Kickoff
- All 4 teams spawned in parallel with clear scope briefs.
- Each team commits to its own feature branch and pushes to origin when done.
- Ground rules: no dead code, no console.logs, tsc --noEmit must pass, clean up as you go.

### 2026-10-14 ~03:10 EDT — Theme (feature/v2-theme) DONE
- Rebrand Cockpit → Crystal (user-facing only; internal identifiers, file names, API paths, localStorage keys, DB tables untouched):
  - package.json name → "crystal".
  - Root metadata title was already "Crystal" — verified.
  - Rewrote brand copy in: admin layout (title/description/403 page/header), error + global-error pages, invite flow (welcome + shared-list title), share-invite email templates (also rewrote the "smart assistant called Crystal" line, redundant now that Crystal is the app), Outlook permission error message, nudge source attribution ("From Crystal…", test updated), bills/shopping/subscriptions/crew applets empty-state + link-copy, station-categories blurb.
  - Favicon: verified existing ICO is the Crystal neon robot, RGBA multi-size (16/32/48/64) — kept as-is, no rebuild needed.
- StarCraft theme tokens (src/app/globals.css):
  - Backgrounds → deep space navy: abyss #070b16, panels #0a101f/#0d1528/#131c33.
  - Accents: neon-cyan now glowing cyan #22d3ee; neon-teal stays mint teal #5eead4.
  - Text: soft white #f2f8fc, ice blue #b9d4e4, muted slate #7d92a6, new light ash gray #c3ccd4 (--color-ash).
  - New utilities: .glass-panel (frosted glass: navy/55% + 16px backdrop blur, hairline border, neon edge) and .glow-cyan (neon text glow). Scrollbar/selection hover shifted cyan.
- Toolbar chrome (src/components/toolbar-console.tsx, CSS only — structure/behavior/aria identical):
  - Shelf: deep navy gradient (#0b1122→#070c18) with a faint cyan underglow.
  - Light strip: teal → glowing cyan #22d3ee with stronger halo.
  - Key bank: frosted glass (backdrop-blur 14px, white/10 border, neon edge).
  - Keys: navy-machined bases, ice-blue text, cyan ignition on press/active, cyan 3px rail + engaged pips; orb reactor core kept mint teal as the brightest element.
  - Doc comments updated to match ("Crystal Console", cyan light strip).
- Verified: npx tsc --noEmit clean, npm run build succeeds, nudges engine test 28/28 pass.
- No console.logs, no dead code, no commented-out blocks introduced.
- Note: remaining "cockpit" strings are internal only (localStorage keys like cockpit.todos*, DB table cockpit_layouts, device_name cockpit-cloud, API URLs, code comments). The Azure app registration named "Cockpit" is an actual infra object — text now says "Crystal app in Azure"; renaming the registration itself is out of scope.
- Overlap note: touched only the CSS + doc comments in toolbar-console.tsx; Team Toolbar owns structure on feature/v2-toolbar — expect a merge conflict in that file; mine is chrome-only so resolution is straightforward (keep their structure, keep my chrome, or re-apply colors after).

## Decisions
- Original ~/workspace/cockpit is untouched; all work happens in ~/workspace/crystal-v2.
- Merge strategy TBD: teams merge to main after coordinator review of each branch.
