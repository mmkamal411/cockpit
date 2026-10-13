# App ↔ Crystal-Worker Chat Contract — v2 (canonical)

**Status:** Phase 0 C1 — canonical contract established 2026-10-13 (branch
`phase0/c1-context-contract`). This document is the single source of truth.
Any drift between this document, `contract.ts`, and the worker's parsing is a
bug, full stop.

**Why v2 exists:** before this change the app sent a new `ChatContextBundle`
(`pilot.name`, `now`, `weather`, `agenda`, `todos`, `nudges`, `crew`) while the
Crystal worker still parsed the legacy d-dash shape (`pilotName`,
`studentName`, `timeOfDay`, `grades`, `dueNext`, …). Result: the worker
silently dropped every new field and fell back to `displayName → "pilot"`,
"(no grade data right now)", "(nothing on the scope right now)". The context
pipeline ran correctly on the app side and almost none of it reached the
model's system prompt. That drift is fixed here.

## Wire format

`POST {CRYSTAL_URL}/chat` (HTTPS, server-side only — the browser never calls
the worker through the chat path; killing the last client-direct path is W1's
scope):

```jsonc
{
  "messages": [{ "role": "user" | "assistant", "text": "…" }],
  "context": {
    "context_version": 2,
    "pilot": { "name": "Mehedi" | null, "timezone": "America/New_York" | null },
    "now": "2026-10-13T18:56:00.000Z",
    "weather": "72°F, Sunny in Marietta (high 78°, low 61°)",        // optional
    "agenda": ["9:30 AM — Dentist @ Main St"],                       // optional, ≤12
    "todos": ["Buy milk (due 2026-10-14)"],                         // optional, ≤12
    "nudges": ["bill/high: Electric due — $142"]                    // optional, ≤8
  },
  "mode": "crystal" | "fireball"
}
```

Worker replies `{ "reply": "…", "persona": "crystal" | "fireball" }`.

### Contract rules (both sides)

1. **Closed field set.** The context bundle may contain ONLY the keys above.
   Unknown fields are rejected LOUDLY, never silently dropped and never
   forwarded.
2. **Required:** `context_version` (must equal the version the worker knows),
   `pilot` (`name` and `timezone` each `string | null`), `now` (ISO
   timestamp). Missing/mistyped → loud 4xx from the worker / loud
   `ContractViolationError` in the app.
3. **Legacy fields are dead.** `pilotName`, `studentName`, `timeOfDay`,
   `grades`, `dueNext`, `weakestClass`, `belowGoal`, `crew` are NOT part of v2.
   If any of them appear in a bundle, that is a violation — reject loudly.
4. **`mode` is strict:** `"crystal" | "fireball"` only. (Legacy `"pookie"` /
   `"muse"` values no longer originate anywhere in the app.)
5. **Messages:** `{role: "user"|"assistant", text}` only, non-empty, ≤4000
   chars each; the worker keeps the last 20.
6. **Privacy invariant:** no crew/child signals, no emails, no credentials, no
   raw coordinates, no behavioral aggregates. See the inventory below.

## Field inventory + privacy sign-off (C1)

Every field the app sends the worker today, classified and signed off.

| # | Field | Source | Classification | May be sent? | Sign-off / notes |
|---|-------|--------|----------------|--------------|------------------|
| 1 | `context_version` | contract constant | technical | ✅ yes | Lets the worker reject bundles it doesn't understand. No personal data. |
| 2 | `pilot.name` | `pilots.display_name` | identity (pilot) | ✅ yes | Pilot's own chosen display name; used to address them. Never email, never a child name. `null` when unset. |
| 3 | `pilot.timezone` | `pilots.timezone` | technical | ✅ yes | Needed to interpret "today" in agenda/day bounds. Coarse (IANA zone), not location. |
| 4 | `now` | generated | technical | ✅ yes | ISO timestamp — the model's "today". No personal data. |
| 5 | `weather` | Open-Meteo, fetched server-side from `pilots.home_lat/lon` | content (situational) | ✅ yes | Reduced to ONE line of conditions + city label from `home_location` ("in Marietta"). **Raw coordinates never leave the app** — they stay in the server-side fetch. City granularity only. |
| 6 | `agenda` | pilot's Supabase calendar cache | content (pilot-owned) | ✅ yes | Today's event titles/times (≤12). Pilot's own calendar. |
| 7 | `todos` | `todos` table (pilot-scoped) | content (pilot-owned) | ✅ yes | Open todo titles + due dates (≤12). |
| 8 | `nudges` | `nudges` table (pilot-scoped) | content (pilot-owned) | ✅ yes | Active nudge titles/kind/priority (≤8, detail ≤120 chars). |
| 9 | `messages[].role/text` | `chat_messages` (pilot-scoped) | content (pilot-owned) | ✅ yes | The pilot's own words to Crystal; bounded (≤4000 chars/msg, 20/thread-turn). The whole point of chat. |
| 10 | `mode` | applet keyword trigger | technical | ✅ yes | Persona switch (`crystal`/`fireball`). |
| 11 | ~~`crew`~~ | ~~`crew_members.name/relationship`~~ | identity — **CHILD DATA** | ❌ **NO — P0 VIOLATION, REMOVED** | **Was sending `"Children linked: <child names> (<relationship>)"` to the worker.** This violates the locked 2026-10-13 founder decision: *crew/child signals are EXCLUDED from behavioral collection*. Removed 2026-10-13 in this change — `crewSection()` deleted from `context.ts`, `crew` dropped from the type, and `toWireContext()` rejects any bundle containing a `crew` key LOUDLY so it can never silently reappear. |

**Residual note (honest, not blocking):** agenda/todo/nudge *titles* are
pilot-authored free text — a pilot could write a child's name into a todo
("Pick up Dawson"). That is the pilot's own content addressed to their own
co-pilot, not structured crew-signal collection, and scrubbing it is a
product decision for Meheldi, not a Phase 0 fix. No structured child field
reaches the worker anymore.

### Locked founder decisions honored by this contract (2026-10-13)

- **Crew/child signals EXCLUDED** — enforced by removal + loud validator rejection.
- **14-day raw-signal retention** — the chat bundle is per-request and
  stateless; the app retains nothing from it outside the pilot's own
  `chat_threads`/`chat_messages` (their chat history, not behavioral signals).
  Aggregation runs on a Cloudflare Worker, where the 14-day policy applies —
  not in this path.
- **Crystal chat BASE 85 surfaced** — the chat entry point is available on ~85%
  of screens; every surface uses this same contract.
- **No new anon-readable paths** — this change adds no routes and touches no
  RLS; `/api/chat` still requires a signed-in pilot (401 otherwise).

## Drift fixed by this change (app side)

1. **Child data to the worker (P0):** `crewSection()` sent children's names +
   relationships on every chat turn. Deleted. `toWireContext()` now rejects a
   `crew` key loudly.
2. **Contract made explicit + versioned:** `context_version: 2` pinned in
   every bundle; closed field set; `src/lib/chat/contract.ts` is the canonical
   TS type shared by the route and the builder.
3. **Loud failures replace silent drift:** outbound bundles are validated in
   `route.ts` before the fetch — `ContractViolationError` → structured
   server-side log + plain-English 502 to the pilot ("I couldn't put your
   answer together…"). The worker's reply envelope is validated too (empty /
   malformed → loud, never rendered as a blank).
4. **Worker reply persona honored:** the worker labels its persona on every
   response; the route now propagates it to SSE/JSON instead of echoing the
   requested mode.
5. **False budget claim removed:** `context.ts` no longer claims "well under a
   2000-token budget" — field-level caps are documented honestly; token
   counting is a Phase 3 item.

## Worker-side changes REQUIRED (for the worker team — W1 scope)

The worker (`d-dash-app/workers/crystal/src/index.ts`, deployed at
`crystal.mehedikamal.workers.dev`) still parses the legacy shape and silently
ignores the v2 bundle. Until it is updated, **chat works but unpersonalized**:
the model sees name `"pilot"` and no weather/agenda/todos/nudges. Nothing
breaks — the worker degrades, as it always has.

To complete C1, the worker must:

1. Replace `ChatRequest["context"]` with the v2 shape:
   ```ts
   interface ChatContext {
     context_version: 2;
     pilot: { name: string | null; timezone: string | null };
     now: string;
     weather?: string;
     agenda?: string[];
     todos?: string[];
     nudges?: string[];
   }
   ```
2. Validate LOUDLY in the `/chat` handler before building the prompt:
   reject (400, plain-English `error`) when `context_version` is missing/≠2,
   when required fields are missing or mistyped, or when ANY unknown key is
   present (this is the tripwire that catches a re-added `crew` field). Never
   silently default to `"pilot"`.
3. Build the system prompt FROM the v2 fields: address the pilot by
   `context.pilot.name`, use `now` for "today", and inject the situational
   blocks (weather / agenda / todos / nudges) only when present — with the
   degraded-mode rule: a missing block means "no data", not "nothing today",
   so the model must hedge, not assert emptiness.
4. Map legacy fields explicitly if the old d-dash path still needs them —
   never mix them into the v2 prompt silently.
5. `contract.ts` in this directory is dependency-free and can be copied
   verbatim into the worker for the validation logic.

The Phase 0 checklist item flips to done when the worker is redeployed with
this validation AND a live request shows the model addressing the pilot by
name with the situational blocks present in the prompt (browser-verified on
staging, per the test-before-you-claim rule).
