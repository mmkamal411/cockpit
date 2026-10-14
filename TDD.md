# CRYSTAL v2 — Technical Design Document (TDD)

**Document Version:** 1.0
**Date:** 2026-10-14
**Companion Documents:** BRD.md · MCP.md · SOLUTION-PLAN.md · TEST-PLAN.md

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLOUDFLARE EDGE                       │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐  │
│  │  Pages   │  │ Workers  │  │  Workers AI            │  │
│  │ (Next.js)│  │ (APIs)   │  │  (Llama / Grok route)  │  │
│  └──────────┘  └──────────┘  └────────────────────────┘  │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │  Queues  │  │Durable Objs  │  │  R2 (files/video)  │   │
│  └──────────┘  └──────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│                      SUPABASE                            │
│  Postgres + Auth + RLS + Vault + Realtime                │
└─────────────────────────────────────────────────────────┘
```

## 2. Frontend Design

### 2.1 Tech Stack
- Next.js 16 (App Router), React 19, TypeScript 5
- Tailwind CSS + CSS custom properties (theme tokens)
- Deployed to Cloudflare Pages via direct upload (git-connected when stable)

### 2.2 Theme Token System
**File:** `src/styles/theme-tokens.css`

```css
:root {
  --space-navy-900: #060a14;
  --space-navy-800: #0a0e1a;
  --space-navy-700: #111827;
  --charcoal-translucent: rgb(17 24 39 / 0.72);
  --neon-cyan: #22d3ee;
  --neon-mint: #5eead4;
  --ice-blue: #bae6fd;
  --soft-white: #f8fafc;
  --slate-muted: #64748b;
  --ash-gray: #9ca3af;
  --glass-blur: blur(16px);
  --neon-glow-cyan: 0 0 20px rgb(34 211 238 / 0.4);
}
```

### 2.3 Component Hierarchy
```
CockpitShell
├── VideoBackground (looping, mobile-lite, reduced-motion still)
├── AppletHost (windowing system)
│   └── AppletContent (registry: home, education, health, comms, finance, shopping, ...)
├── ToolbarConsole (StarCraft command center)
│   ├── AbilityGrid (3×3, cooldowns)
│   ├── RadarSweep (canvas 360°)
│   ├── SquadStatus
│   ├── TacticalFeed / CommsFeed
│   ├── RedAlertIndicator
│   └── CrystalPilotSeat (mascot)
├── CrystalCommandBar (global, every screen)
└── SoundEngine (Web Audio synthesizer)
```

### 2.4 Crystal Mascot Component
**File:** `src/components/crystal/crystal-mascot.tsx`

Layers (bottom → top):
1. `CrystalBody` — SVG snow-white fluffy body paths
2. `CrystalAccents` — neon highlight overlays (props: `accentColors`)
3. `CrystalFace` — eyes + mouth; 7 mood SVGs crossfaded via opacity
4. `CrystalBehavior` — `useCrystalBehavior()` hook: idle, reactions, patrol

```typescript
type CrystalMood = "happy" | "curious" | "sleepy" | "excited" | "celebrating" | "thinking" | "neutral";
interface CrystalMascotProps {
  mood: CrystalMood;
  size: number;
  accentColors?: [string, string]; // default: cyan + pink
  interactive?: boolean; // click → cycles mood + plays sound
}
```

### 2.5 Toolbar Widgets

**AbilityGrid** (`src/components/toolbar/ability-grid.tsx`):
- 3×3 grid; each ability: `{ id, icon, label, cooldownMs, action }`
- Cooldown state machine: `ready → cooling → ready`; radial progress overlay
- Abilities: Quick Add Task, Check Calendar, Message Crystal, Toggle Red Alert, Global Search, Open Home, Open Education, Open Health, More

**RadarSweep** (`src/components/toolbar/radar-sweep.tsx`):
- `<canvas>` 120×120; `requestAnimationFrame` 360° sweep
- Blips = today's priority items positioned by urgency angle
- Respects `prefers-reduced-motion` (static)

**SoundEngine** (`src/lib/sound/sound-engine.ts`):
- Web Audio API; oscillator + gain envelope; no audio files
- Sounds: `click`, `open`, `close`, `alert`, `success`, `cooldownReady`
- Master mute toggle persisted to localStorage

## 3. API Design (Connect-RPC)

### 3.1 Service Definitions
**Proto:** `proto/crystal/v1/crystal.proto`

```protobuf
service TaskService {
  rpc ListTasks(ListTasksRequest) returns (ListTasksResponse);
  rpc CreateTask(CreateTaskRequest) returns (Task);
  rpc CompleteTask(CompleteTaskRequest) returns (Task);
}
service EducationService {
  rpc GetClasses(GetClassesRequest) returns (GetClassesResponse);
  rpc GetStudyPlan(GetStudyPlanRequest) returns (StudyPlan);
  rpc SubmitCheckIn(SubmitCheckInRequest) returns (CheckIn);
}
service HealthService {
  rpc LogMetric(LogMetricRequest) returns (Metric);
  rpc GetTrends(GetTrendsRequest) returns (Trends);
}
service BriefingService {
  rpc GetDailyBriefing(GetDailyBriefingRequest) returns (Briefing);
}
service SearchService {
  rpc GlobalSearch(GlobalSearchRequest) returns (GlobalSearchResponse);
}
```

### 3.2 Client Generation
- `buf generate` → TypeScript clients into `src/lib/api/gen/`
- All API calls go through generated clients (no raw fetch to APIs)

## 4. Data Design (Supabase Postgres)

### 4.1 Core Tables
Every table: `id uuid PK`, `user_id uuid FK → auth.users`, RLS `user_id = auth.uid()`.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `pilots` | User profile | `id`, `email`, `display_name`, `created_at` |
| `tasks` | To-dos | `title`, `due_at`, `priority`, `completed_at`, `list_id` |
| `classes` | School classes | `name`, `period`, `teacher`, `grade_pct`, `source` |
| `assignments` | Homework/tests | `class_id`, `title`, `due_at`, `points`, `status` |
| `study_plans` | AI plans | `class_id`, `target_pct`, `steps jsonb` |
| `check_ins` | Daily check-ins | `class_id`, `text`, `photo_url`, `ocr_text` |
| `health_metrics` | Steps/glucose/etc | `metric_type`, `value`, `recorded_at` |
| `medications` | Med list | `name`, `dosage`, `schedule jsonb` |
| `bills` | Bills | `payee`, `amount`, `due_at`, `paid_at` |
| `stocks` | Watchlist | `symbol`, `added_at` |
| `shopping_lists` | Lists | `name`, `shared_with jsonb` |
| `shopping_items` | Items | `list_id`, `name`, `checked` |
| `briefings` | Daily briefings | `date`, `content jsonb` |
| `audit_log` | Sensitive access | `actor`, `action`, `target`, `at` |

### 4.2 RLS Policy Pattern
```sql
CREATE POLICY "user_isolation" ON tasks
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### 4.3 Migrations
- Sequential: `001_*.sql`, `002_*.sql`, …
- No cross-table RLS recursion (lesson 2026-10-13: use SECURITY DEFINER helpers)

## 5. AI Pipeline

```
User input
  → Intent Router (Workers AI, llama-3.3-70b)
      → Simple (reminder, lookup) → Workers AI direct
      → Complex (study plan, analysis) → Grok fallback
      → Image/doc → OCR (Workers AI vision) → text → router
  → Rate limiter (per user/min) → Response
```

## 6. PWA & Offline

- `manifest.json`: name "Crystal", icons (192/512), display standalone
- Service worker: cache-first for shell; network-first for API
- Offline queue: mutations stored in IndexedDB, synced on reconnect
- Push: Web Push via Workers; VAPID keys in env

## 7. Security Design

- Supabase Vault for third-party credentials (never plaintext)
- RLS on every table; service_role only in Workers (never client)
- Audit log on: auth events, credential access, child data access, admin actions
- CSP headers; no inline scripts except nonces

---

*Verification: TEST-PLAN.md*
