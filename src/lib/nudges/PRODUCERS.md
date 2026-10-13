# Nudge Producer Contract

**For:** Teams A (calendar), B (todos), and any future producer (bills, weather,
school, Crystal). **Version:** 1.0 — Phase 1.

The nudge engine is a pipeline: **producers emit candidates → the engine scores,
dedupes, schedules (quiet-hours aware), and inserts → the pilot sees them** in
the glass pane, the Today briefing, and the nudge-center applet.

The engine works with **zero producers** — it just stays quiet. Producers are
optional signal sources, never required infrastructure.

---

## 1. Submitting a candidate

```
POST /api/nudges/candidates
```

**Auth — either:**
- Server-to-server: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
  (cron workers, server producers). `pilot_id` comes from the body.
- Pilot session: the request's session cookie. `pilot_id` in the body must
  match the signed-in pilot (403 otherwise).

**Body:**

```json
{
  "pilot_id": "uuid — who this nudge is for (required)",
  "category": "meeting | bill | weather | todo | school | health | system (required)",
  "title": "Electric bill $142 due today (required, ≤300 chars)",
  "body": "Optional detail, ≤2000 chars",
  "dedup_key": "bill:elec-2026-10 (required, ≤300 chars — see §3)",
  "source": "bills (required, ≤80 chars — your module name)",
  "source_ref": { "bill_id": "abc" },
  "scheduled_for": "2026-10-13T09:00:00-04:00",
  "deadline": "2026-10-13T23:59:59-04:00",
  "tier": "normal | urgent"
}
```

Only `pilot_id`, `category`, `title`, `dedup_key`, `source` are required.
`scheduled_for` defaults to "as soon as it makes sense". `tier` defaults to
`"normal"`.

**Response:**

| Outcome | Status | Body |
|---|---|---|
| Inserted | 201 | `{ action: "inserted", id, score, scheduled_for }` |
| Duplicate (already live) | 200 | `{ action: "deduped", score }` |
| Below pilot's min score | 200 | `{ action: "suppressed", reason: "below_min_score", score }` |
| Category muted by pilot | 200 | `{ action: "suppressed", reason: "category_disabled", score }` |
| Bad candidate | 422 | `{ error: "..." }` |
| Engine trouble | 503 | `{ error: "..." }` |

**The golden rule: a failed producer never breaks the engine — and a failing
engine never breaks the producer.** Wrap your submission in try/catch. On any
non-2xx or network error: log it, skip this run, try again next cycle. That
category simply goes quiet; everything else keeps working. Never retry in a
hot loop — back off to your next scheduled run.

---

## 2. Scoring — what makes a nudge loud

`score = category base × urgency multiplier`, computed by the engine:

| Category | Base | Typical use |
|---|---|---|
| `system` | 90 | Safety / critical account issues |
| `meeting` | 80 | Meeting starting soon |
| `bill` | 70 | Due / overdue bills |
| `school` | 60 | Missing assignment, grade drop (children linked only) |
| `weather` | 50 | Precipitation onset, severe weather |
| `todo` | 40 | Due-soon / overdue todos |
| `health` | 30 | Gentle health prompts (noisiest by nature — keep them rare) |

Urgency multiplier comes from `deadline` (falling back to `scheduled_for`):
**< 1h → 1.5×, < 24h → 1.2×, otherwise 1.0×.** Past-due counts as < 1h.

You don't set the score — you set an honest `deadline` and the engine does
the math. Don't game it: inflating urgency trains the pilot to ignore you.

---

## 3. Dedupe keys — the same event gets one nudge

`dedup_key` is a **stable key for the underlying event**, not the nudge.
Format: `<category>:<your-stable-id>`. Examples:

- Calendar: `meeting:<event_id>` (same meeting → one reminder, even if
  calendar, Crystal, and a rule all notice it)
- Bills: `bill:<bill_id>:<due_date>` (re-nudges next cycle when the due date rolls)
- Weather: `weather:rain:<YYYY-MM-DD>` (one "bring the umbrella" per day)
- Todos: `todo:<todo_id>`
- School: `school:missing:<assignment_id>`

While a nudge with that key is live (`pending`, `delivered`, `snoozed`, or
`acknowledged`), resubmitting is a no-op (`deduped`). Once it expires or is
muted, the key becomes eligible again. A concurrent-submission race is also
absorbed: the unique index turns it into `deduped`, not an error.

**Dedupe window (spec open question — Phase 1 answer):** a key suppresses
re-notification until its nudge reaches `expired` or `muted`. Producers that
want repeat reminders (e.g. daily bill nag) should either set `expires_at`
semantics via distinct keys per cycle (`bill:<id>:<date>`) or re-emit after
the pilot acknowledges.

---

## 4. Quiet hours — never wake the pilot

Default **22:00–07:00 pilot-local**, configurable per pilot. A candidate
scheduled inside quiet hours is **held and delivered at quiet-hours end** —
it queues visibly ("2 waiting for morning") rather than vanishing.

- `tier: "urgent"` breaks through **only** when the pilot has explicitly
  opted in (`breakthrough_allowed`). Reserve `urgent` for safety and
  truly time-critical events. Everything else is `normal`.
- Don't do your own quiet-hours math — submit the honest time; the engine
  shifts it.

---

## 5. What the engine does with your candidate

1. **Scores** it (importance × urgency).
2. **Checks the pilot's gates**: category enabled? score ≥ `min_score`?
   (Suppressed candidates return 200 — not an error.)
3. **Dedupes** against live nudges with the same `dedup_key`.
4. **Schedules** it quiet-hours aware.
5. **Inserts** one row; the glass pane, Today briefing, and nudge center
   pick it up from there.

Producers never write to the `nudges` table directly and never decide
delivery timing. If you need a nudge updated or withdrawn, that runs through
a future producer API — for Phase 1, emit a new candidate with a new key.

---

## 6. Minimal producer example

```python
# bills producer (cron) — Python, stdlib only
import json, urllib.request, os

SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

def emit_nudge(pilot_id, title, dedup_key, deadline, body=None):
    payload = {
        "pilot_id": pilot_id,
        "category": "bill",
        "title": title,
        "dedup_key": dedup_key,
        "source": "bills",
        "deadline": deadline,
    }
    if body:
        payload["body"] = body
    req = urllib.request.Request(
        "https://cockpit.pages.dev/api/nudges/candidates",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {SERVICE_KEY}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read())
    except Exception as e:
        # Golden rule: log and move on. This category goes quiet this run.
        print(f"nudge emit failed (non-fatal): {e}")
        return None
```

## 7. Phase 1 producer checklist

- [ ] Emit at most once per underlying event per cycle (the engine dedupes,
      but don't spam the endpoint).
- [ ] Use stable `dedup_key`s in `<category>:<id>` form.
- [ ] Set honest `deadline`s; leave `tier` at `normal` unless safety-critical.
- [ ] Never assume the pilot has your data connected — no data, no candidates,
      no upsell ("connect your bills!" is not a nudge).
- [ ] School nudges only when children are linked to the pilot.
- [ ] Wrap every submission in try/catch; never let a nudge failure fail
      your sync.

Engine implementation: `src/lib/nudges/engine.ts`.
Tests: `src/lib/nudges/engine.test.ts` (`node src/lib/nudges/engine.test.ts`).

## 8. Running the producers (Phase 1)

The MVP producers live in `src/lib/nudges/producers/`:

| File | What it does |
|---|---|
| `meeting-soon.ts` | Meetings starting within 60 min (visible calendars, no cancelled/all-day) |
| `bill-due.ts` | Unpaid bills due within 3 days or overdue (snoozes respected) |
| `index.ts` | `runProducers(db, { pilotId? })` — runs every registered producer per pilot, golden-rule wrapped |
| `producers.test.ts` | 59 unit tests — `npm run test:producers` |

The scheduled trigger is `POST /api/nudges/producers/run` (service-key
auth, same pattern as §1). Optional body `{ "pilot_id": "uuid" }` scopes to
one pilot; omit it to run for every pilot. Response is a per-pilot,
per-producer summary of inserted/deduped/suppressed/skipped counts plus any
captured (non-fatal) errors.

**Recommended cadence: every 15 minutes.** The producers are dedupe-safe —
repeat runs are cheap no-ops (one quick SELECT per event/bill, engine
returns `deduped`). The 60-minute meeting window plus a 15-minute cadence
means the earliest reminder lands ~45–60 min before a meeting and the
latest ~0–15 min before.

Example scheduler (use curl — Python urllib POSTs get 403 from this stack):

```bash
# every 15 minutes — needs SUPABASE_SERVICE_ROLE_KEY in the environment
curl -s -X POST "https://cockpit.pages.dev/api/nudges/producers/run" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Use the staging URL (`https://pookie-staging.pages.dev`) when testing —
never point a scheduler at staging by accident in production, or pilots get
double nudges. One scheduler per environment, exactly one.
