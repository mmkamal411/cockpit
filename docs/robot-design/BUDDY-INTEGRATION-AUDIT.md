# Crystal Buddy — Integration Audit (read-only)

**Auditor:** Senior Software Architect (subagent)
**Date:** 2026-10-13
**Target:** `src/components/pilot/crystal-robot.tsx` (718 lines) @ commit `c06cf84`,
branch `feature/crystal-robot`, flag `NEXT_PUBLIC_CRYSTAL_ROBOT`
**Method:** read-only code audit; every claim cites file, line, and code. No files modified.

---

## 1. Every place the character touches the app

### 1.1 Render sites — all 5 toolbar variants render `CrystalCommandButton`

| Variant | File | Callsite | Orb class | Orb size |
|---|---|---|---|---|
| console | `src/components/toolbar-console.tsx` | lines 135–139 | `console-orb` | 58x58 |
| dash | `src/components/toolbar-dash.tsx` | lines 207–213 | `dash-orb` | 58x58 |
| hologlass | `src/components/toolbar-hologlass.tsx` | lines 125–130 | `hologlass-orb` | 58x58 |
| legacy | `src/components/toolbar-legacy.tsx` | lines 99–104 | `crystal-orb` | 58x58 |
| panoramic (current; `TOOLBAR_VARIANT = "panoramic"`, toolbar-variant.ts:20) | `src/components/toolbar-panoramic.tsx` | lines 230–236 | `pano2-orb` | 44x44 |

Only one toolbar mounts at a time (`ToolbarSwitch`, `src/components/toolbar-switch.tsx:15`), so
exactly one robot instance exists per page. `SoothingOrb` mounts once in the root shell
(`src/components/cockpit-shell.tsx:122`) and finds the button via
`document.querySelectorAll("#toolbar-crystal-orb")` (`src/components/pilot/soothing-orb.tsx:33`).

**Only other touch point:** `celebrateCrystal()` / `noticeCrystal()` are exported from
`crystal-robot.tsx:37-47` for future wiring. Grep confirms **zero call sites and zero dispatches**
of `crystal:celebrate` / `crystal:notice` anywhere else in `src/` — the helpers are currently
dead exports. No conflict risk today, but nothing consumes them yet.

### 1.2 Orb fallback path — byte-identical when flag is off ✅ VERIFIED

`CrystalCommandButton` (`crystal-robot.tsx:586-628`) returns, when the flag is not `"true"`:

```tsx
<button
  type="button"
  id="toolbar-crystal-orb"
  onClick={onOpen}
  data-active={active}
  data-waiting={waiting}
  aria-label="Talk to Crystal — your AI co-pilot"
  aria-current={ariaCurrent}
  title="Crystal"
  className={className}
>
  {coreClassName ? (<span className={coreClassName} aria-hidden="true" />) : null}
</button>
```

I diffed this against the pre-commit markup of all five toolbars (`git show c06cf84~1`):

- **console:** original had no `data-active`, no `data-waiting`, no `aria-current`. The fallback passes
  those props as `undefined`, which React does **not** emit as DOM attributes → identical.
  `coreClassName="console-orb-core"` → same inner `<span>`. ✅
- **dash:** original `data-active={crystalActive}` and `aria-current={crystalActive ? "page" : undefined}`.
  Fallback receives `active={crystalActive}` + `ariaCurrent={crystalActive ? "page" : undefined}` → identical. ✅
- **hologlass:** original `data-active`, no `aria-current` → identical. ✅
- **legacy:** no data-* attributes originally → identical. ✅
- **panoramic:** original `data-active={orbActive}` + `data-waiting={orbWaiting}`; fallback receives
  `active={orbActive} waiting={orbWaiting}` → identical. ✅

`onClick={() => openApplet("crystal")}` vs `onOpen` is behaviorally identical (same handler).
**Verdict: reverting = one env var; the fallback is byte-identical DOM to the pre-robot code.**

### 1.3 z-index layers — no stacking conflicts introduced

The robot sets **no z-index anywhere** (`grep -c z-index` on `crystal-robot.tsx` = 0). It inherits
the toolbar's stacking context:

- Toolbar navs: `position: fixed … z-[80]` (e.g. legacy, `src/components/toolbar-legacy.tsx:77`).
- Applet backdrop + dock: `z-index: 90` (`src/components/applet-host.tsx:308,367`).
- Transit veil: `z-index: 120`, pointer-events none (`src/components/cockpit-shell.tsx:79`).

Applet chrome (z-90) covers the toolbar (z-80) — the robot included — exactly as the orb is
covered today. Robot motion spans never leave the toolbar's stacking context.
**Verdict: no new stacking conflict.**

Cosmetic note: `.crystal-robot-mode { overflow: visible !important; }` lets the robot paint *outside*
its button box (waddle ±28px, trip rotation, jump), overlapping neighboring toolbar keys during
antics. That is the intended "walks the toolbar" effect, not a bug, and it stays within the
toolbar's paint area.

### 1.4 Mobile / small screens (375px)

- The robot sits in the same centered slot as the orb — never at a viewport edge — so nothing
  clips off-screen at 375px.
- Waddle range (`WADDLE_RANGE = 28`, `crystal-robot.tsx:55`) keeps it well inside the toolbar width.
- The robot track is fixed 44x44px (`crystal-robot.tsx:673-678`); in 58px slots it renders slightly
  top-left-offset (see §4.1), in the 44px panoramic slot it's exact. No collision with the
  applet-dock (120px above safe-area bottom, `applet-host.tsx:367`).
**Verdict: no 375px collisions. Safe.**

### 1.5 prefers-reduced-motion ✅ VERIFIED

`reduced` is read once via `matchMedia` (`crystal-robot.tsx:339-343`). When true:

- the blink loop and idle-antics effects return early and never start (`crystal-robot.tsx:368,399`);
- the `crystal:celebrate` / `crystal:notice` listeners are never registered (`crystal-robot.tsx:489`);
- `handleMouseMove` and the click spin early-return (`crystal-robot.tsx:517,549`);
- the CSS `@media (prefers-reduced-motion: reduce)` block kills all robot animations
  (`crystal-robot.tsx:705-710`).

SoothingOrb independently exits early for reduced motion (`soothing-orb.tsx:57`), so both
systems agree. The one residual: the window `hush` listeners (`keydown/pointerdown/touchstart`,
`crystal-robot.tsx:479-486`) are registered even under reduced motion — they are passive,
do ~nothing, and are removed on unmount, so this is harmless. **Verdict: correct handling.**

### 1.6 Global event listeners ✅ all cleaned up

| Listener | Where | Cleanup |
|---|---|---|
| `keydown`, `pointerdown`, `touchstart` (passive) on `window` | hush effect, `crystal-robot.tsx:479-486` | removed in same effect's return |
| `crystal:celebrate`, `crystal:notice` on `window` | `crystal-robot.tsx:502-509` | `removeEventListener` in return (capture defaults match) |
| mousemove | React `onMouseMove` on the `<button>` itself (`crystal-robot.tsx:561`) — not a window listener, React detaches with the element | n/a |
| blink/idle loops | `setTimeout` chains guarded by `alive` flags (`crystal-robot.tsx:374,403`) | effects return `() => { alive = false; }` |

No leaked listeners: every `addEventListener` has a matching `removeEventListener` in the same
effect's cleanup. No window-level scroll/resize/mousemove tracking — cursor tracking is button-scoped.

### 1.7 Timers ✅ all cleared on unmount

Every `setTimeout` is funneled through `later()` (`crystal-robot.tsx:358-360`), which pushes handles
into `timers.current`. The mount-only effect at `crystal-robot.tsx:362-368` clears all of them on
unmount. Blink (4–7s), idle (15–30s), hush (8s), and every action-recovery timeout all go through
this path.

Theoretical race (low risk): a timeout scheduled *during* the unmount window would land in
`timers.current` after the clear loop ran, and would fire post-unmount — but every chained
callback re-checks `alive` first (`if (!alive) return`), and `alive` is set false by each
loop effect's cleanup, so the callbacks are no-ops. **Verdict: no timer leaks in practice.**

---

## 2. Performance

### 2.1 Re-render frequency

- **Steady state:** blink (every ~3.8–7s), idle antics (15–30s), plus CSS-only loops. ~a handful of
  React re-renders per minute. Negligible.
- **Cursor tracking (the one hot path):** `handleMouseMove` (`crystal-robot.tsx:516-528`) runs on
  **every `mousemove` over the button** (up to ~60/sec while hovering) and calls `setPupil` with a
  **brand-new object each time** — so React's state bail-out never engages, and `RobotBody`
  re-renders its ~45-node SVG tree on every event, even when the clamped values didn't change
  (e.g. holding the cursor still fires no events, but any micro-movement re-renders).
  Cost per render is small (React diff of a static-ish SVG tree, no layout work in the handler
  beyond `getBoundingClientRect()` on a fixed button), and it's scoped to hovering a 44–58px
  target. Not a perf emergency, but it is the single highest-frequency render path in the
  component. **Recommended micro-fix (one line):** round the clamped values and skip the
  `setPupil` when they equal the previous — e.g. guard with a ref comparison. See §4.
- **SVG rendering model:** the SVG re-renders **only on state changes** (`face` / `pupil` /
  `action` / `walkX`) — there is no per-frame React render. All continuous motion (idle bob
  `crystal-idle`, glow, waddle, jump, wave, trip, spin, track `transition`) is CSS-driven.
  Correct architecture.

### 2.2 CSS animation cost

- All keyframes animate `transform` and/or `opacity` only (`crystal-robot.tsx:637-703`) —
  **compositor-only, no layout thrash.**
- The SVG-level `filter: drop-shadow(0 0 10px …)` on `.crystal-robot-svg` is **static** (not
  animated) — it adds one GPU filter pass per paint of the button, cheap for a 44px element.
  The animated glows use `opacity` on the antenna/heart, not `filter`. Good.
- `.crystal-robot-track` uses `transition: transform 0.45s ease-in-out` (compositor-friendly).
- `overflow: visible` on the SVG + button means the button's paint region grows during antics;
  trivially small.

### 2.3 Mousemove handler cost

`getBoundingClientRect()` per event on a fixed-position button — forces a sync layout read only
if layout is dirty; normally it returns cached geometry. The real cost is the forced re-render
from the new-object `setPupil` (see §2.1). No throttling, no rAF batching. Acceptable today,
worth the one-line guard if the character ships permanently.

---

## 3. Conflict risk with future UI changes

| Future change | Risk | Evidence |
|---|---|---|
| **Toolbar redesigns** | LOW — the component deliberately adapts | It takes `className` (the variant's orb class) and renders inside the existing orb slot; the CSS neutralizes orb chrome (`background: transparent !important` etc.) so any orb styling stays inert. Only requirement: the new slot keeps `id="toolbar-crystal-orb"` for SoothingOrb. |
| **SoothingOrb drift controller** | LOW — verified composition | Drift writes the *independent CSS `translate` property* on the button (`soothing-orb.tsx:187`); robot motion lives on *nested spans' `transform`* (`crystal-robot-track`, `crystal-robot-body`). These are separate CSS properties that compose per spec. The one exception is the console variant, whose centering transform is destroyed by the neutralizer — see §4.3. |
| **New applet overlays** | NONE | Robot sets no z-index; applet chrome is z-90, above the toolbar's z-80. It covers the robot exactly like the orb. |
| **z-index changes** | NONE from the robot itself | No z-index in `crystal-robot.tsx`. If a future change gives a toolbar element a new stacking context (e.g. `transform` on a wrapper), SoothingOrb's `translate` on the button still works — it's inside the same context. |
| **Theme changes** | LOW | Robot colors are hardcoded inline in the SVG (`#0e2a3a`, `#cdeefb`, etc.) — they won't auto-follow a theme change, but they also won't break one. The neutralizer kills the orb's theme-colored glow, which is intended. |
| **New toolbars added later** | LOW — but read §4.4 | A 6th variant must (a) keep `id="toolbar-crystal-orb"` on the slot, (b) avoid relying on the button's `transform` for layout (console lesson), and (c) pass `ariaCurrent` through if it uses `aria-current`. |
| **Multiple toolbars mounted simultaneously** | LOW / cosmetic | Not possible today (ToolbarSwitch picks one), but if it ever happened, the SVG gradient ids `crystalScreen`/`crystalShell` would duplicate document-wide — `url(#crystalScreen)` resolves to the first instance's defs (identical, so visually fine). Making the ids unique per instance (e.g. `useId`) would future-proof it. |
| **`<style>` inside the button** | LOW | `CRYSTAL_ROBOT_CSS` is injected per mount (`crystal-robot.tsx:582`). Single mount today = single copy. Duplicate mounts = duplicate identical blocks — harmless. |

---

## 4. Redesign recommendations

### 4.1 🔴 REQUIRED — console variant: hover teleports the robot ~29px

**Files:** `src/components/toolbar-console.tsx:223-238`, `src/components/pilot/crystal-robot.tsx:661-665`

The console orb centers itself with `transform: translate(-50%, -50%)` (absolute positioning,
`left: 50%; top: 50%`). The robot neutralizer kills it:

```css
/* crystal-robot.tsx:664-665 */
.crystal-robot-mode:hover { transform: none !important; }
```

`!important` wins over both `.console-orb`'s base transform and its `:hover` scale. So in robot
mode on the console toolbar, **hovering the robot drops its centering transform and the button
snaps to the `left:50%/top:50%` origin — a ~29px right-and-down jump** (animated over the
orb's 200ms `transition: transform`, so it visibly slides, then slides back on mouseleave).
The other four variants use `position: relative` with no base transform, so they're unaffected.

**Fix:** scope the hover neutralization so it only kills the *scale*, not the centering — e.g.
in `CRYSTAL_ROBOT_CSS`, replace the blanket rule with:

```css
.console-orb.crystal-robot-mode:hover { transform: translate(-50%, -50%) !important; }
```

or carry the centering into the robot track. One rule, one variant.

### 4.2 🟡 RECOMMENDED — robot loses the panoramic active glow

**Files:** `src/components/toolbar-panoramic.tsx:508-514`, `src/components/pilot/crystal-robot.tsx:655-660`

`.pano2-orb[data-active="true"]` signals "Crystal chat is open" via `box-shadow` — but the
neutralizer (`background: transparent !important; box-shadow: none !important;`) removes it,
so **in robot mode the panoramic toolbar has no visible "Crystal is active" state**. (Dash is
unaffected — its active glow lives on the `.dash-bezel` wrapper at `toolbar-dash.tsx:375`.)

**Fix:** add an explicit robot-mode active cue, e.g.
`.crystal-robot-mode[data-active="true"] .crystal-robot-svg { filter: drop-shadow(0 0 14px rgb(94 234 212 / 0.8)); }`
so the robot itself glows when active.

### 4.3 🟡 RECOMMENDED — `aria-current="page"` is dropped in robot mode

**Files:** `src/components/pilot/crystal-robot.tsx:586-628`

`CrystalCommandButton` accepts `ariaCurrent` and passes it to the orb fallback, but never
forwards it to `CrystalRobotButton`. The dash variant sets `ariaCurrent={crystalActive ? "page" : undefined}`
(`toolbar-dash.tsx:211`), so **flipping the robot flag on silently removes the `aria-current="page"`
accessibility marker**. Forward the prop (one line).

### 4.4 🟡 RECOMMENDED — robot slightly off-center in 58px slots

**File:** `src/components/pilot/crystal-robot.tsx:673-678`

```css
.crystal-robot-track { display: block; width: 44px; height: 44px; transition: transform 0.45s ease-in-out; }
```

The track is a fixed 44px block; inside the 58px orb slots (console/dash/hologlass/legacy) the
block span sits top-left of the button's content box, so the robot is **~7px off-center**
(left/up). In the 44px panoramic slot it's exact. Add `margin: 0 auto;` (horizontal) — or better,
make the track `width:100%; height:100%` and center the SVG — so the robot sits centered in any
slot size. (Also then waddle ±28px stays symmetric about the slot center.)

### 4.5 🟢 OPTIONAL — mousemove setState guard

**File:** `src/components/pilot/crystal-robot.tsx:516-528`

`handleMouseMove` calls `setPupil({...})` with a new object on every event, forcing a full SVG
re-render at up to ~60/sec while hovering, even when clamped values are unchanged. One-line
guard (round + ref-compare) would cut this to only render on actual pupil movement.

### 4.6 🟢 OPTIONAL — `useId()` for the SVG gradient ids

**File:** `src/components/pilot/crystal-robot.tsx:236-249`

`id="crystalScreen"` / `id="crystalShell"` are hardcoded. Fine with a single mount; `useId()`
would make simultaneous mounts safe (see §3 table).

### 4.7 Nothing else needs redesign

Explicitly: **no toolbar needs a layout redesign** (the robot lives in the existing orb slot,
no new DOM structure, no viewport footprint change), **no z-index changes** (robot sets none,
applet/modals/toast layers are untouched and correctly ordered), **no mobile layout changes**
(no 375px collisions), **no SoothingOrb changes** (`translate` vs nested `transform` compose
correctly), and **no fallback-path changes** (verified byte-identical). The event/timer cleanup
is correct and needs no rework.

---

## Appendix — files read

- `src/components/pilot/crystal-robot.tsx` (full, 718 lines)
- `src/components/pilot/soothing-orb.tsx` (full — drift controller)
- `src/components/toolbar-console.tsx`, `toolbar-dash.tsx`, `toolbar-hologlass.tsx`,
  `toolbar-legacy.tsx`, `toolbar-panoramic.tsx` (callsites + orb CSS)
- `src/components/toolbar-switch.tsx`, `src/components/toolbar-variant.ts`
- `src/components/applet-host.tsx` (applet z-index), `src/components/cockpit-shell.tsx`
  (SoothingOrb mount, transit veil z-index)
- `git show c06cf84~1:src/components/toolbar-*.tsx` (pre-commit orb markup for fallback diff)

*Audit performed read-only; no source files were modified. The report file itself was created at
`docs/robot-design/BUDDY-INTEGRATION-AUDIT.md`.*

