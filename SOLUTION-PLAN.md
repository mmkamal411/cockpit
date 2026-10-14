# CRYSTAL v2 — Solution Plan

**Document Version:** 1.0
**Date:** 2026-10-14
**Companion Documents:** BRD.md (requirements) · MCP.md (execution) · TDD.md (detailed design) · TEST-PLAN.md (verification)

---

## 1. Problem Statement

Busy individuals and families juggle 6+ disconnected apps for tasks, school, health, money, and messages. Context-switching causes things to fall through cracks. Existing solutions are either single-purpose (Todoist, Mint) or parent-centric dashboards that don't serve the individual.

## 2. Solution Overview

**Crystal** unifies life management into a single StarCraft-inspired cockpit:
- One AI co-pilot (Crystal) that understands plain English and reads documents
- Six modules (Home, Education, Health, Communications, Finance, Shopping) in a consistent windowing system
- A command-center toolbar with ambient awareness (radar, feeds, alerts)
- Built on Cloudflare's edge + Supabase, designed for 1M+ users from day one

## 3. Solution Approach

### 3.1 Reuse, Don't Rewrite
The v2 build starts from the Cockpit codebase (`~/workspace/cockpit`), which already has:
- Next.js 16 + Supabase auth + RLS foundation
- Applet windowing system (minimize/close, no page reloads)
- Working modules: todos, calendar, weather, school sync, shopping, health, bills
- Crystal chat via Cloudflare Workers AI

We rebrand, retheme, and extend — not rewrite.

### 3.2 Theme as a Token System
All StarCraft styling flows through CSS custom properties:
```css
--space-navy: #0a0e1a;
--neon-cyan: #22d3ee;
--neon-mint: #5eead4;
/* ... */
```
Components reference tokens, never hardcoded colors. This makes future theme variants (light mode, seasonal) trivial.

### 3.3 Mascot as a Component System
Crystal the mascot is a layered SVG/CSS component:
- **Base layer:** Snow-white fluffy body (SVG paths)
- **Accent layer:** Neon highlights (configurable colors)
- **Face layer:** Big blue eyes + expressions (7 moods, crossfade via opacity)
- **Behavior layer:** Idle animations, reactions, patrol (separate CSS/JS, portable)

### 3.4 Toolbar as a Command Center
The StarCraft toolbar composes independent widgets:
- Ability grid (3×3, each with cooldown state machine)
- Radar (canvas 360° sweep, requestAnimationFrame)
- Feeds (tactical + comms tickers, Durable Objects in production, polling in v1)
- Red Alert (global state → theme shift + audio)
- Sound engine (Web Audio API oscillator-based synthesizer)

Each widget is independently testable and replaceable.

### 3.5 Modules as Applets
Every module is an applet: self-contained, opens in a window, minimizes to the toolbar. New modules follow the existing applet contract (`applet-content.tsx` registry). No module can break another.

### 3.6 AI as a Layered Service
```
User input → Intent router → Workers AI (fast, free)
                           → Grok fallback (complex, flagged)
                           → OCR pipeline (images/docs)
```
Rate limits per user per minute. All AI calls logged for cost monitoring.

### 3.7 Data as User-Isolated Silos
Every table has `user_id` + RLS policy. The app never queries across users. Sharding later = routing by `user_id`, no schema change.

## 4. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Copy, don't fork, the Cockpit repo | Clean break; original stays as rollback reference |
| CSS tokens for theming | Future themes without component changes |
| SVG/CSS mascot (not images) | Crisp at all sizes; mood crossfades are cheap |
| Web Audio for sounds (not files) | Zero asset weight; dynamic pitch/effects |
| Connect-RPC for APIs | Typed contracts; gRPC semantics; codegen clients |
| Queues for background jobs | Decouples sync/OCR/briefing from request path |
| Durable Objects for live feeds | Stateful connections without polling |
| R2 for files/videos | Cheaper than Supabase storage at scale; edge-cached |

## 5. Phased Delivery

| Phase | Delivers | Validates |
|-------|----------|-----------|
| Foundation | Rebrand + theme + landing + mascot + toolbar + Home | "Does it feel like Crystal?" |
| Hardening | DB + auth + rate limits + CI/CD + staging | "Is it production-safe?" |
| Education | School integrations + AI study plans + check-ins | "Does it help students?" |
| Comms + Shopping | Gmail/Outlook/Drive + lists | "Does it reduce app-switching?" |
| Health + Finance | Manual entry + bills + stocks | "Is it a daily driver?" |
| Launch | Load test + security + legal | "Can it scale to 1M?" |

Each phase ends with a browser-verified staging deploy. No phase starts until the prior phase's acceptance criteria pass.

## 6. Risk Mitigation by Design

- **AI cost explosion →** Rate limits + free-tier-first routing + cost dashboards
- **School source breakage →** Multi-source with ParentVUE fallback; adapters are swappable
- **Theme perf on mobile →** Lighter videos, `prefers-reduced-motion`, GPU-only animations
- **Scope creep →** BRD is the gate; new requirements need founder approval
- **Child privacy →** Under-13 = parent-managed; zero behavioral collection on child accounts

---

*Detailed component/API/data design: TDD.md*
*Verification strategy: TEST-PLAN.md*
