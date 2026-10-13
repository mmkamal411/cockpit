# Crystal Robot — 3 Design Directions

**Status:** Awaiting Meheldi's selection
**Date:** 2026-10-13
**Constraint:** Soothing rule — calm, never jarring. Spacecraft cockpit aesthetic (dark, icy blue/white/black, minimal purple).

---

## Direction 1: Sleek Humanoid — "The Co-Pilot"

![Sleek Humanoid](sandbox://workspace/cockpit/docs/robot-design/media-generation-robot-direction-1-sleek-humano-0-b1284179-770f-4a3e-a2fd-e4582c2cd3a4.webp)

**Concept:** A polished, premium humanoid robot — the professional co-pilot sitting at the yoke beside you. Dark gunmetal faceplate, large expressive cyan eyes, subtle white neon contour lines like cockpit instrument lighting, gentle smile.

**Personality:** Confident, capable, warm. Feels like a trusted first officer.

**Pros:**
- Most "grown-up" — matches a productivity platform for adults
- The face builds immediate relationship (Meheldi's core ask)
- Neon contour lines echo the existing toolbar aesthetic perfectly

**Cons:**
- Most complex to render well at small toolbar sizes
- Could feel slightly formal/serious vs. playful

**Build approach:** SVG illustration (vector, crisp at any size). Eyes blink on a slow cycle (every 6–9s, 150ms close). Subtle head tilt toward cursor on hover. Breathing glow on the core light.

---

## Direction 2: Cute Companion Bot — "The Buddy"

![Companion Bot](sandbox://workspace/cockpit/docs/robot-design/media-generation-robot-direction-2-companion-bo-0-a7b9146a-a154-4fea-988f-be566b0da39f.webp)

**Concept:** A round, huggable companion bot — WALL-E charm meets premium design. Big sparkling cyan eyes, happy smile, glowing antenna tip, soft white-and-dark shell with neon trim.

**Personality:** Joyful, loyal, playful. Feels like a friend who's always happy to see you.

**Pros:**
- Maximum emotional warmth — hardest not to love
- Simplest shapes = reads clearly even at tiny sizes
- The smile + big eyes deliver "happy robot" instantly

**Cons:**
- Could feel too playful/cute for a serious productivity tool
- Less "spacecraft commander" energy

**Build approach:** SVG illustration. Bouncy-but-gentle idle (slow squash-and-stretch, 4s cycle). Antenna tip pulses softly. Eyes do a happy "blink-smile" (∧ ∧ shape) when you complete a task. Wiggle on tap.

---

## Direction 3: Holographic Entity — "The Spirit"

![Holographic Entity](sandbox://workspace/cockpit/docs/robot-design/media-generation-robot-direction-3-holo-orb-0-34cac985-54fe-4e7e-8c2a-418dff231313.webp)

**Concept:** Bridges the orb's DNA with a robot character. The glowing orb becomes the head — with a simple happy light-face (two gentle eyes, warm smile). Below, a translucent holographic body of shimmering cyan light-particles with faint scan-lines.

**Personality:** Ethereal, calm, magical. Feels like a benevolent ship's spirit.

**Pros:**
- Honors the orb's legacy — evolutionary, not replacement (easiest revert story)
- Most unique — no other app has this
- The hologram aesthetic is pure spacecraft cockpit

**Cons:**
- Particle effects are harder to do well in SVG/CSS (may need canvas)
- The "face" is simpler — less expressive than the other two

**Build approach:** Hybrid — the orb head stays as the existing glowing element (reuse current orb rendering), holographic body as layered CSS/canvas particle shimmer. Face is drawn in light on the orb surface. Gentle particle drift, scan-line sweep every ~12s.

---

## How the Winner Gets Built

Regardless of direction:

1. **Revert plan:** The orb stays in the codebase untouched. A feature flag (`NEXT_PUBLIC_CRYSTAL_ROBOT`) switches between orb and robot. One env var reverts instantly. The `SoothingOrb` wander controller is reused as-is — it tracks `#toolbar-crystal-orb` by ID, and the robot keeps that same ID.

2. **Soothing animations only:** All motion follows the existing tuning — slow ease-in-out, long durations, small radii. Blink cycles ≥6s. No sudden movements, no bouncing, no sound.

3. **Interactivity:**
   - Click → opens Crystal chat (same as orb today)
   - Hover → gentle acknowledgment (head tilt / glow brighten / happy blink)
   - Task complete → celebratory micro-expression (happy eyes / antenna pulse / particle burst)
   - Typing/dragging → hushes and stills (same as orb's interaction hush)
   - `prefers-reduced-motion` → fully static

4. **Toolbar fit:** The robot seats in the same yoke hub where the orb sits today. Same click target size (≥44px touch). Same `data-active` / `data-waiting` states drive visual changes (e.g., eyes brighten when Crystal has something to tell you).

5. **Testing:** Built on a feature branch, deployed to staging, verified in the parent agent's own browser end-to-end (per TEST BEFORE YOU CLAIM) before Meheldi sees it.

---

## Meheldi — Your Call

Reply with **1**, **2**, or **3** (or a mix — e.g., "2's face on 1's body").
