# User Settings — Placement & Applet Design (Phase 1, design only)

**Date:** 2026-10-13 · **Status:** design recommendation, no code
**Applies to:** Cockpit Console (recommended), Panoramic Dash, Hologlass toolbar directions

---

## 1. Placement recommendation: (b) — inside the More menu as a proper station

**Recommendation: put Settings in the More applet as a full proper station (same visual weight as the 31 modules), pinned as a fixed row so it never scrolls out of sight.** Do not add a 6th toolbar key. Add a 44px pilot-avatar button top-right of the header as a *secondary, complementary* shortcut — it is not the primary placement.

### Why not (a): 6th nav key — rejected on three independent grounds

**Shelf math (hard fail at 320px).** With the 58px orb centered and 16px side padding:

| Width | Current 4 side keys | 6 keys (8px gaps) | 6 keys (6px gaps) | ≥44px target? |
|---|---|---|---|---|
| 320px | 49.5px | **38.0px** | **40.0px** | ❌ fails |
| 390px | 67.0px | 52.0px | 54.0px | ✓ but cramped |
| 430px | 77.0px | 60.0px | 62.0px | ✓ |

iPhone SE-class 320px widths are still in use — one failing width kills the option. At 390px the keys shrink to ~52px, which crowds 11px labels + status dots + 3px active rails inside square backlit keys, and the 58px orb loses its anchor presence (orb barely larger than the keys around it).

**Symmetry.** The orb sits at dead center by design. Six keys around a centered orb forces 3+3 (Progress moves *across* the orb — muscle memory destroyed) or 2+3 (visually lopsided, orb reads off-balance). There is no 6th slot that preserves both symmetry and the existing spatial map.

**Frequency mismatch.** Settings is a monthly-use function. A permanent backlit key charges a "visual noise tax" on every glance for something used once a month, and it would sit next to Crystal — the highest-frequency key — inviting mis-taps.

### Why not (c) as primary: avatar/gear affordance

The avatar pattern ("tap your face") is the best single pattern for the grandmother test and it is pilot-first by nature. But the founder's requirement is explicit: reachable **from the redesigned toolbar**. A header avatar is not the toolbar, and top placement lands in the stretch zone on 430px phones for one-handed use. Use it as reinforcement, not the primary.

### Why (b) wins

- **Thumb reach:** More is already a thumb-side station; total path is two easy taps (More → Settings).
- **Muscle memory:** the 5-station map is completely untouched. Zero layout change at 320/390/430px.
- **Discoverability (grandmother test):** "More" is the universal junk drawer — every non-technical user already knows extra stuff lives under More/Menu. To guarantee she finds it: **pin Settings as a fixed footer row at the bottom of the More applet** (always visible, never scrolls away under the 31 modules), labeled in plain English **"Settings"** — not "Preferences," not "Control Deck," not "Pilot Console" (cockpit metaphors fail the grandmother test).
- **Frequency match:** low-frequency function behind a menu is correct IA.

---

## 2. Settings as an applet — spec

**Opens like every other applet.** `openApplet("settings")` raises the settings overlay at the applet layer (z-90), toolbar stays visible beneath (z-80, per the existing z-index contract). Phase-1 note for implementation: the applet host must register `"settings"` as an applet id alongside today/crystal/progress/more.

**Getting back.** The applet header carries three exits, in this priority order:
1. **✕ close (top-right)** — closes the applet entirely (`closeAllApplets`), revealing whatever was underneath.
2. **‹ Settings back chevron** — shown only inside a sub-section; returns to the settings home list (in-applet navigation, not a new applet id).
3. **Home station** — closes the applet and routes home (existing C5 contract order preserved). Tapping **More while Settings is open** returns to the More applet home, since Settings is More's child.

**Active state while open:** the **More station keeps its 3px neon active rail lit** while the settings applet is open — continuity of "you are in the More area." No new rail logic, no rail on the avatar shortcut (it's not a station key).

**Internal structure:** settings home is a single scrolling list of six section rows (the iOS-Settings pattern every smartphone user already knows), each with a one-line plain-English description and a disclosure chevron. Tapping a row pushes the detail panel in with the ‹ Settings back chevron. Rows that aren't wired yet show an honest "not connected yet" state — never a dead toggle.

**Section list:**
1. **Pilot Profile** — "Your name, email, and photo"
2. **Integrations** — "Calendar, health, school — connect or disconnect" (each row: status dot + connect/disconnect; school row folds in the old School Logins as a re-auth flow, never raw password display)
3. **Notifications & Nudges** — "What Crystal tells you, and when" (per-type toggles with `role="switch"`, quiet hours)
4. **Privacy & Data** — "What Crystal can see, and how long we keep it" (per-source visibility toggles, retention, download/delete)
5. **Appearance** — "Theme and motion" (dark cockpit variants, reduced motion, orb behavior)
6. **Account** — "Sign out or delete your account" (delete uses the old DangerZone pattern: plain-English confirmation, no jargon)

---

## 3. Integration into the three design directions

### Cockpit Console (recommended)
Settings appears as the pinned footer row in the More applet: a square key styled exactly like the toolbar's backlit station keys (same keycap treatment, same 2px teal top-light language), carrying a **gear glyph** in teal-white neon + the plain-English label "Settings" + chevron. Active state: the key shows the pressed/backlit state while the settings applet is open, and the More station's 3px neon rail stays lit on the shelf. **Icon choice: gear, not avatar, not sliders.** Grandmother-test justification: the gear is on her microwave, her car dashboard, and her iPhone — it universally means "settings." A slider glyph reads as "audio mixer" to non-technical users; an avatar reads as "my account," which is only half the content (she'd never look for nudge preferences behind her face).

### Panoramic Dash (arched top edge, stations on an arc)
Same IA — Settings lives inside More, never a 6th key on the arc. The arc geometry makes a 6th key even worse than on the flat shelf (keys crowd the apex, labels collide on the curve). The pinned Settings row in the More applet inherits the Dash's arched visual language (arched top edge on the row, same neon treatment). Gear glyph, same grandmother-test reasoning. Active state: More's arc position glows while settings is open.

### Hologlass (near-invisible plate, minimal chrome)
Same IA — Settings inside More. The entry row uses Hologlass's minimal chrome: hairline separators, no card background, gear glyph + "Settings" + chevron. **Do not strip the gear glyph for minimalism** — an icon-less text row in a near-invisible plate is exactly where a non-technical user stops seeing it. The gear is load-bearing for discoverability here. Active state: a whisper of teal on the row + More's minimal active indicator stays lit on the plate.

---

## 4. Old settings module: port vs. drop

Reviewed: `settings-ui.tsx`, `settings-view.tsx`, `child-settings-view.tsx`, `family-view.tsx`, `independence-view.tsx`, `credentials-view.tsx`, `sync-console.tsx`, `worker-health.tsx`.

**Port (adapted to pilot-first):**
- **Profile basics** → Pilot Profile section (name, email, avatar).
- **Notification toggles with `role="switch"`** → Notifications & Nudges (the a11y pattern was good; keep it).
- **DangerZone account delete** → Account section (plain-English confirmation).
- **School Logins concept** → reborn as the school row inside Integrations: connect/disconnect + re-auth flow. Never show or edit raw passwords.
- **The honest "not wired yet" per-card state** → keep the spirit everywhere: rows that aren't connected say "not connected yet," never render dead toggles.
- **Sync freshness ("last synced Xh ago")** → slimmed down to a single freshness line inside the Integrations school row. The *freshness* is pilot-relevant; the machinery is not.

**Drop from pilot settings (do not port):**
- **Sync Console (live sync queue) and Worker Health (agent heartbeats)** — these are parent-ops/support tools, not pilot settings. Relocate to an ops surface: the full console + heartbeats belong in the Support module area (7th menu category, agent-backend side) or a role-gated admin view. They must never sit next to "change your name."
- **Family / Sharing / Independence tabs** — superseded by the pilot-first architecture. Child features live in the feature menu (add child, school login, permissions per the registration decisions); Sharing/child-access grants live on their own Sharing screen per the locked child-access-authority decisions; "Go independent" is a graduation flow, not a settings tab.
- **The entire role-gated tab concept (`/c/[childSlug]/settings`, "Parents Only" notices)** — dies with the parent-centric IA. Pilot settings has no roles; if an admin area exists, it is gated separately, not inside the pilot's settings.

---

## Open questions for the build team
1. Does the More applet have (or need) search? If yes, "Settings" should be a top search hit.
2. Avatar shortcut: photo upload source (device camera vs. library) and whether the avatar button also surfaces sign-in state (signed-in email on long-press).
3. Admin/ops surface for Sync Console + Worker Health: new home (Support module vs. separate admin area) needs an owner and a design pass.
