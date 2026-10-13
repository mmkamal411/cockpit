# 07 — Layout Engine UI: Frontend Developer Evaluation

**Role:** Frontend Developer (1 of 2) — LAYOUT ENGINE UI
**Date:** 2026-10-13
**Scope:** Evaluation only. No production code written.

---

## 1. Current-rendering audit (what exists today)

### 1.1 The navigation surface: a fixed 5-station toolbar

**`src/components/toolbar.tsx`** is the only primary navigation surface. It hardcodes:

```tsx
const stations = [
  { label: "Today",    glyph: <TodayGlyph />,    run: () => openApplet("today") },
  { label: "Crystal",  glyph: <ChatGlyph />,    run: () => openApplet("crystal") },
  { label: "Progress", glyph: <ProgressGlyph />,run: () => openApplet("progress") },
  { label: "More",     glyph: <MoreGlyph />,     run: () => openApplet("more") },
];
```

rendered as `stations.slice(0, 2)` → Crystal orb → `stations.slice(2)`, with Home as a separate always-first button. **Ordering is structural, not data:** positions are determined by array slicing in JSX. Reordering requires editing the file; there is no registry, no prop, no hook that could supply a different order.

### 1.2 The applet registry: a flat key→def map with zero ordering metadata

**`src/components/applet-content.tsx`** defines:

```ts
export interface AppletDef {
  name: string;      // display name
  readout: string;   // chrome readout
  glow: string;      // neon accent
  render: (params: AppletParams) => ReactNode;
}
export const APPLETS: Record<string, AppletDef> = { today, crystal, progress, more, crew, bills, weather, calendar, shopping, health, nudges };
```

Eleven registered applets. `Record<string, AppletDef>` means **iteration order = insertion order** and there is no per-module concept of: order weight, prominence tier, grouping, enabled/hidden, icon glyph, blurb, or capabilities. Every consumer that lists modules hand-rolls its own list.

### 1.3 The "More" applet: a second, duplicated hardcoded ordering

**`src/components/applets/more-applet.tsx`** contains its own:

- `SEEDLINGS` array (6 entries: Health, Money, Mail, Shopping, Travel, Learn — some linked to real applets via `appletId`, some inert "Seedling · growing soon" cards)
- a hardcoded "Core stations" grid (`today`, `crystal`, `progress`)
- a hardcoded "Crew" section

So module-ordering knowledge currently lives in **three places**: the toolbar (`toolbar.tsx`), the More applet (`more-applet.tsx`), and the applet registry (`applet-content.tsx`) — plus a fourth, the link-interception map `MODULE_ROUTES` in `src/lib/applet-bus.ts`. None of them agree on a single source of truth, and none are dynamic.

### 1.4 The home page: no module list at all

**`src/app/home/page.tsx`** (server component) renders only `<HeroVista />` (idle float, daypart video) and `<GlassPane />` (weather + week strip). There is deliberately no module grid on home today — "Everything else is a station you visit from the toolbar." The home page currently has **no render surface for an AI-ordered module list**; one must be designed.

### 1.5 The shell and bus

- **`src/lib/applet-bus.ts`**: external store `{ open, minimized, justRestored }`. One open applet at a time, minimized dock. No layout concept; `openApplet(id)` is imperative and string-keyed.
- **`src/components/applet-host.tsx`**: modal overlay chrome (glow dot + readout + minimize + close), per-applet `AppletErrorBoundary` with a plain-English crash card — the established pattern for error UI we must reuse.
- **`src/components/cockpit-shell.tsx`**: composes video vista, transit veil, `Toolbar`, `SoothingOrb`, `AppletHost`.

### 1.6 The database exists; nothing reads or writes it

`cockpit_layouts` was created in `supabase/migrations/001_pilot_foundation.sql` (`id, pilot_id, layout jsonb, generated_at, active boolean, created_at`; RLS enabled; index on `pilot_id`). **Zero references in `src/`** outside admin counts/view-as (`src/app/api/admin/users/[id]/route.ts`, `…/view-as/route.ts`). No client fetch, no writer, no cache. The schema is fine for a first pass — a `layout` jsonb blob with one active row per pilot — but app logic must decide the blob's contract.

### 1.7 Client-side state patterns available

`src/lib/local-store.ts` (`readLocal`/`writeLocal`) is the established pattern for pilot-scoped device-local state (todos, crew). A layout cache + override store will fit the same pattern before server sync ships.

### 1.8 How hard would dynamic ordering be *today*?

**Very hard without a refactor.** There is no module registry — there is a render registry. To reorder modules you'd have to edit JSX in `toolbar.tsx` and `more-applet.tsx` and keep them in sync by hand. Any AI-generated layout would have nowhere to plug in. The refactor surface is well-bounded though (see §5).

---

## 2. Dynamic layout UI design

### 2.1 Where does the AI-ordered list live?

Three surfaces need dynamic ordering, in priority order:

| # | Surface | Today | Becomes |
|---|---------|-------|---------|
| S1 | **More applet** (all stations) | hardcoded sections | the full AI-ordered module list, grouped by prominence tier |
| S2 | **Home deck** (new) | vista + glass pane only | "Today's stations": a horizontal hero strip of the 3–5 modules the AI expects the pilot to need *today* — morning ritual made tangible |
| S3 | **Toolbar quick-slots** (optional, Phase 3+) | fixed 5 | AI may swap one flank slot (e.g. Health before a doctor's appointment); Home + Crystal + More stay fixed as anchors |

Design decision: **do not reorder the toolbar in Phase 1.** The toolbar is the pilot's muscle memory — re-ranking it is jarring and risks violating "never jarring." AI ordering first manifests in More + the Home deck, where re-ranking feels like helpful curation rather than the controls moving under the pilot's fingers. Toolbar dynamism is Phase 3, gated on pilot opt-in ("Let Crystal tidy my toolbar").

### 2.2 Prominence tiers — visual language inside the cockpit theme

Every module gets a tier from the layout plan. Tiers are visual, not just ordering:

**Tier 1 — Spotlight (hero).** One module max on the Home deck, the AI's "start here" pick.
- A wide glass panel (full-width on mobile, ~2× tile width on desktop), backdrop-blur, the module's neon `glow` as a soft outer halo + an inset top-edge light line.
- Shows live context, not just a name: e.g. Health shows "Sleep 7h12 · HRV 61ms"; Bills shows "2 bills due this week · $214".
- Slow breathing glow (reuse the orb's 5.5s `orb-breathe` easing; reduced-motion → static).
- Tap opens the applet. Long-press opens override menu (§3).

**Tier 2 — Stations (standard).** The working grid.
- Tiles exactly like today's More cards: `rounded-2xl border border-line bg-panel-2/60`, glow dot + name + one-line blurb. Grid 1-col mobile / 2-col sm / 3-col lg.
- These are the module's "instrument panel" — consistent chrome everywhere.

**Tier 3 — Lower deck (tucked-away).** Modules the AI demoted or the pilot dismissed.
- Compressed rows: glow dot + name + chevron, single-line, half the vertical rhythm of station tiles.
- Collapsed under a "Lower deck — n quieter stations" disclosure (n = count). Expands with a smooth height animation. Nothing is deleted; everything is reachable.

**Seedlings** (unbuilt modules) keep their existing style — dimmer, "Seedling · growing soon" caption — and always render at the end of the Lower deck, never promoted by the AI. They are the future, not today's cockpit.

The tiers map naturally onto the cockpit metaphor: spotlight = the panel the co-pilot highlights on your yoke; stations = your instrument row; lower deck = systems you don't touch every flight.

### 2.3 The Home deck (S2) — proposed markup contract

Home gains a scrollable region *above* the glass pane (or the pane becomes the first card of a deck). Morning-ritual order:

1. Glass pane (weather + week strip — already exists, keep as the opening instrument)
2. "Today's stations" — spotlight panel + up to 4 station tiles, horizontally scrollable on mobile, grid on desktop
3. One line of plain-English explanation: *"Crystal put Health up front because your sleep dip is 3 days running."* with a "Change" affordance (§3). This satisfies principle 4 — every automated decision explains itself — at the point of display, not buried in settings.

### 2.4 Re-ranking transitions — the layout must be as soothing as the orb

When a new active layout arrives (AI re-rank, pin applied, sync pull), the list must **not jump**:

- **FLIP morph, not instant reorder.** Capture positions pre-update; animate tiles to new positions with a 450ms `cubic-bezier(0.22, 1, 0.36, 1)` translate/scale, then commit. Fade promoted tiles in through their glow color; demoted tiles cross-fade to their new tier style *after* arriving.
- **Stagger arrivals** by ~40ms per tile, capped total under 800ms. Slow enough to feel calm, fast enough to not bore.
- **Never animate the toolbar in Phase 1–2** (fixed anyway); never animate while an applet overlay is open — queue the re-rank until the pilot returns to the list, then animate once. A layout that reshuffles *under* the pilot's finger is the failure mode.
- **`prefers-reduced-motion: reduce`**: all of the above collapses to an instant swap, no exceptions (the codebase already honors this for the orb — same convention).
- **New arrivals** (first sync of a new module): a soft "new station" shimmer on the tile for one session, then normal. No badge-count inflation, no popups.
- **Departures** (AI demotes to Lower deck): the tile visibly "settles down" — slides into the Lower deck disclosure and the disclosure count increments. The pilot sees where things *went*, which is the core trust mechanic.

### 2.5 Layout data contract (what `layout` jsonb should hold)

Proposed minimal contract the frontend consumes (engine team owns generation):

```json
{
  "version": 1,
  "modules": [
    { "id": "health", "tier": 1, "rank": 0, "pinned": false,
      "why": "Sleep dip is 3 days running — Health up front this morning.",
      "context": { "line1": "Sleep 7h12", "line2": "HRV 61ms" } }
  ],
  "overrides": { "bills": { "pinned": true }, "mail": { "hidden": true } },
  "generated_at": "2026-10-13T05:44:00Z"
}
```

- `modules`: full AI proposal, `id` matching the applet registry key, `tier` ∈ {1,2,3}, `rank` within tier, `why` = the grandmother-test explanation (required for tiers 1–2, optional for 3), optional `context` lines for the spotlight panel.
- `overrides`: user-authored, wins over the AI proposal at render time ("the AI proposes, the user disposes"). Stored separately so a re-generated proposal never clobbers pins.
- The client merges: `overrides` applied on top of `modules` → effective order. Pin → tier 1 (or rank 0 of current tier; see §3.2), dismiss → tier 3 + `hidden` filter toggle in Lower deck.

---

## 3. Override interaction design — "the user disposes"

### 3.1 Where overrides live: a per-tile "Station options" menu, plus one global mode

Two complementary entry points:

**A. Long-press / right-click / "⋯" button on any tile (primary).**
- Mobile: 500ms long-press (with a gentle scale-up haptic-style visual at threshold, like iOS icon jiggle intent).
- Desktop: hover reveals a "⋯" button; right-click also works.
- Opens a small glass menu anchored to the tile with 3 actions, plain-English:
  - **"Keep up front"** (pin) — pin glyph
  - **"Send to lower deck"** (dismiss/demote) — down-arrow glyph
  - **"Why is this here?"** — opens the explanation line (the `why` string from §2.5, full sentence)
- Menu items are full sentences where space allows: *"Keep Health up front"* — names the module, grandmother test.

**B. "Rearrange" mode on the More applet (secondary, power users).**
- A "Rearrange" button in the More header enters edit mode: tiles lift with soft shadows and gently "float" (subtle sine drift, echoing the orb's motion language — not a frantic jiggle).
- Drag to reorder within and across tiers; dropping onto the Spotlight zone or Lower deck changes the tier. HTML5 drag on desktop, pointer-events drag on touch (no external DnD library needed — tile count is small; keep the bundle lean).
- "Done" commits; a single "Undo" toast covers the whole session's edits.

Entry-point B exists because drag is the fastest path for "tidy my whole ship"; entry-point A exists because most pilots will only ever pin or dismiss one thing.

### 3.2 What pin / dismiss / reorder do (exact semantics)

| Action | Effect on effective layout | Override record |
|--------|---------------------------|-----------------|
| **Pin** | Module moves to rank 0 of Tier 2 minimum; if the Spotlight slot is empty and the module is tier-2+, pin claims Spotlight. Never displaces another pilot's pin (pins stack in pin order). | `{ pinned: true, pinned_at }` |
| **Dismiss** ("Send to lower deck") | Module moves to Tier 3, collapsed under the disclosure. Still opens normally when tapped. | `{ hidden: true }` — note: "hidden" here means tucked, not deleted |
| **Reorder** (Rearrange mode) | Sets explicit `rank` per tier. Ranks are user-authored and survive AI re-ranks: the AI re-proposes *around* fixed ranks (unranked modules flow around pinned ones). | `{ rank: n, tier: t }` per module |

**AI-respects-user contract (visible in UI):** a pinned tile shows a tiny pin glyph in its corner + the explanation line changes to *"You pinned this — Crystal keeps it up front."* The AI proposal for a pinned module keeps its `why` but the effective UI shows the pin note first. If the AI *would have* demoted a pinned module, the menu's "Why is this here?" still shows the honest original reasoning — the pilot sees both the AI's suggestion and their own veto winning.

### 3.3 Confirmation: "got it, pinned"

- **Instant toast** (bottom, above the toolbar, cockpit-styled glass): *"Pinned — Health stays up front."* / *"Sent to the lower deck — still there when you want it."* One action: **Undo** (5s window).
- **The tile animates immediately** to its new position (§2.4 FLIP) — the confirmation is the motion itself, not just the toast.
- **Persistence:** write to `cockpit_layouts.overrides` via API when online; write to localStorage (`cockpit.layout-overrides`) immediately as the source of truth until the server round-trip confirms. If the server write fails, the override stays local and a quiet "will sync when you're back online" note appears in the toast — never an error dialog for an action the pilot already saw succeed.
- **First-pin education:** the first time a pilot pins anything, the toast grows one line: *"Your pins always win — Crystal arranges around them."* Shown once (localStorage flag), then never again.

### 3.4 Edge cases

- **Pinning a seedling:** disabled — menu shows "Still being built" instead of pin/dismiss. Seedlings can't be promoted.
- **Dismissing everything:** impossible to empty the visible list — More always shows at least the 3 core stations; if the pilot dismisses below that floor, the UI keeps them visible with a note. No blank pages, ever.
- **Module removed from the app:** its override record is ignored silently; pruned on next layout generation.

---

## 4. Loading, error, and empty (cold-start) states

### 4.1 While the layout is being computed

- **Skeleton stations**: the More applet and Home deck render tier-shaped skeletons (one wide spotlight block + 4 tile blocks + lower-deck row) with the existing slow shimmer (same easing family as the orb — calm, not a frantic pulse). Aria: `aria-busy="true"`, screen-reader text "Arranging your stations…".
- **Stale-while-revalidate:** if a cached layout exists (localStorage or last server row), render it immediately and refresh in the background — the pilot never waits on the AI to see their ship. Skeleton only appears when there is genuinely nothing cached.
- **Timeout:** layout fetch/compute has a client timeout (10s). On timeout, fall through to the error state — never an infinite skeleton.

### 4.2 If layout computation fails — never a blank page

Reuse the established `AppletErrorBoundary` pattern (plain-English card + recovery path), but layout failure is a *section*, not the whole applet:

- The More applet / Home deck renders a **fallback layout** = the static default order (today → crystal → progress → health → bills → shopping → calendar → weather → crew → nudges) with a calm inline notice at the top of the list:
  > **"Crystal couldn't arrange your stations just now — showing the standard layout."**
  > *Your pins are safe. [Try again]*
- "Try again" re-fetches. The notice dismisses itself on the next successful layout. No error codes, no "500", no jargon.
- If the failure is persistent (3 consecutive failures), the notice gains one more line: *"If this keeps happening, something's off on our end — nothing you need to fix."* — the grandmother test applied to our own outage.

### 4.3 Cold start — a brand-new pilot

First run, no layout row, no cache, no integrations yet:

1. Brief "Charting your cockpit…" beat (≤1.5s, skeleton) — then the **default arrangement** appears. The default is the IA-blessed order, not an empty state: Home deck spotlight = Today, stations = Crystal, Progress, Health, Bills.
2. A one-time, dismissible welcome card at the top of the More applet: *"This is your ship. As you connect things, Crystal arranges the stations around your life — and your pins always win. [Got it]"* — user-first framing, no parenthood assumptions, no feature upsell.
3. Seedlings render in the Lower deck as today — the "full ship visible from the first tap" launch strategy is preserved.

---

## 5. Refactor evaluation — can the current framework do this?

**Short answer: no, not without a focused refactor. The surface is small and well-bounded.**

### 5.1 What's missing

1. **No module metadata.** `AppletDef` has `name/readout/glow/render`. Needed: `order` (default rank), `section`/tier default, `glyph` (today glyphs live in `toolbar.tsx`, not the registry), `blurb` (today blurbs are inline in `more-applet.tsx`), `capabilities` (e.g. `canPin`, `isSeedling`, `liveContext` provider for the spotlight panel), `route` (today in `MODULE_ROUTES` in the bus).
2. **Ordering knowledge in 3+ places** (toolbar JSX slices, More's sections + SEEDLINGS, `MODULE_ROUTES`). All must derive from one registry.
3. **No layout consumer.** Nothing fetches `cockpit_layouts`, merges overrides, or exposes a `useLayout()` hook.
4. **No per-module context provider.** The Spotlight panel needs live one-liners ("Sleep 7h12"); today each applet is a black box. Registry entries need an optional `peek: () => { line1, line2 }` (or a small async hook) — designed, not built.

### 5.2 Refactor surface (file-by-file)

| File | Change | Size |
|------|--------|------|
| `src/components/applet-content.tsx` | Extend `AppletDef` with `glyph, blurb, defaultTier, defaultRank, isSeedling, canPin, route?`; move glyphs here from `toolbar.tsx`; move SEEDLING metadata in. Registry becomes the **single module catalog**. | M |
| `src/components/toolbar.tsx` | Replace hardcoded `stations` with `toolbarSlots = resolveToolbarSlots(modules)` — fixed anchors (Home, Crystal, More) + dynamic flank from layout. Phase 1: keep fixed, but read from registry. | S |
| `src/components/applets/more-applet.tsx` | Delete `SEEDLINGS` + hardcoded sections; render purely from `useLayout().modules` grouped by tier. Becomes a ~100-line view. | M (net deletion) |
| `src/app/home/page.tsx` + new `src/components/home-deck.tsx` | Add the Home deck (§2.3) rendering spotlight + today's stations from the layout hook. | M (new) |
| **new** `src/lib/layout.ts` | Types (`LayoutPlan`, `ModuleLayout`, `LayoutOverrides`), merge function (AI plan + overrides → effective), default layout, localStorage cache keys, fetch from API. Pure, unit-testable. | M (new) |
| **new** `src/hooks/use-layout.ts` | `useLayout()` — SWR-style: cache-first, background refresh, timeout, error → fallback default. Exposes `{ modules, status: 'loading'|'ready'|'fallback', retry, pin, dismiss, reorder, enterRearrange }`. | M (new) |
| **new** `src/components/station-tile.tsx`, `station-menu.tsx`, `layout-toast.tsx` | Tile (all three tiers via `tier` prop), long-press menu, confirmation toast. Reuses panel/glow CSS tokens. | M (new) |
| **new** `src/app/api/layout/route.ts` (+ `overrides` route) | Read active `cockpit_layouts` row for the pilot; PATCH overrides. RLS already scopes to the pilot. | S–M (new) |
| `src/lib/applet-bus.ts` | No change required (string-keyed open is fine); optionally derive `MODULE_ROUTES` from the registry in a follow-up. | — |
| `src/components/applet-host.tsx` | No change (error boundary pattern reused as-is). | — |

**Estimate: ~1,200–1,600 new lines, ~400 lines deleted/rewritten, across ~10 files. One focused frontend pass — no changes needed to the bus, host, auth, or DB schema.** The migration already gives us the table; the API routes are thin CRUD over it. The layout-generation engine itself (Phase: ARRANGE backend) is out of scope for this doc and is the other developer's domain — this UI is designed to render any plan conforming to the §2.5 contract, including a hand-written default.

### 5.3 Sequencing risk

The UI can be built and shipped **before the AI engine exists**: `useLayout()` falls back to the default plan + local overrides, which is already a strict improvement (user pins/dismiss work; AI re-rank slots in later with zero UI changes). Recommend: ship the registry refactor + static-plan UI first, then wire the engine's output into the same contract.

---

## 6. Per-phase acceptance criteria

### Phase A — Module registry refactor (no visual change)
- [ ] `AppletDef` carries `glyph, blurb, defaultTier, defaultRank, isSeedling, canPin`; glyphs moved out of `toolbar.tsx`.
- [ ] Toolbar renders the same 5 stations, derived from the registry (pixel-identical to today).
- [ ] More applet renders the same sections, derived from the registry (pixel-identical to today).
- [ ] `MODULE_ROUTES` either derived from the registry or documented as the single remaining duplicate.
- [ ] `pnpm build` + `tsc` clean; no behavior change verified by screenshot diff on `/home` and More.

### Phase B — Dynamic rendering + loading/empty/failure states
- [ ] `useLayout()` returns effective module list from cache → API → default fallback; never throws to the UI.
- [ ] More applet renders tiers (spotlight/standard/lower-deck) from the hook; skeleton shows when nothing cached; `aria-busy` correct.
- [ ] Layout API failure renders the fallback layout + the exact plain-English notice in §4.2 with a working "Try again".
- [ ] Cold start shows the default arrangement + one-time welcome card; dismissing it never reappears.
- [ ] `prefers-reduced-motion` produces instant swaps everywhere; verified in browser devtools emulation.

### Phase C — Override interactions
- [ ] Long-press (touch), hover-⋯ + right-click (desktop) open the Station options menu on every live tile.
- [ ] Pin moves the tile to the front with FLIP animation, shows pin glyph + "You pinned this" note, persists across reload (local first, server when online).
- [ ] Dismiss moves the tile into the Lower deck disclosure with count increment; tile remains openable.
- [ ] Rearrange mode: drag across tiers works on touch + mouse; Undo toast reverts the session; "Done" commits.
- [ ] First-pin education toast appears exactly once.
- [ ] AI proposal never overrides a pin/dismiss/reorder rank in the effective render (unit test on the merge function + browser verification).

### Phase D — Transitions, explanations, and polish
- [ ] Re-rank animates with FLIP + stagger (§2.4); no animation fires while an applet overlay is open (queued).
- [ ] Demoted tiles visibly settle into the Lower deck; promoted tiles fade in through their glow.
- [ ] Every tier-1/2 tile's "Why is this here?" shows the `why` string in plain English (grandmother test: no jargon, names a concrete reason).
- [ ] Home deck renders (spotlight panel with live `peek` context lines + up-to-4 stations + explanation line with "Change" affordance).
- [ ] New-module shimmer appears for one session only.
- [ ] Full pass on iOS Safari (touch long-press, drag) and desktop Chrome; reduced-motion verified; no blank page in any failure injection (API 500, timeout, malformed plan JSON).

---

## 7. Open questions for the parent orchestrator

1. **Home deck placement:** scroll region above the glass pane vs. the pane becoming card #1 of the deck — needs a design-eye call against the vista composition.
2. **Spotlight `peek` data:** which modules provide live context lines in Phase 1, and is `peek` sync (local store) or async (fetch)? Propose sync-from-local in Phase 1.
3. **Toolbar dynamism (Phase 3):** confirm it stays gated on explicit pilot opt-in, or cut it from scope entirely.
4. **Layout blob contract (§2.5):** confirm the engine team adopts it, or revise together before either side builds.
