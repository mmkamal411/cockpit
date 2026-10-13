# Cockpit Settings — Full Spec (design only, no code)

**Date:** 2026-10-13 · **Workstream:** research + design · **Status:** design spec, ready for build-team review
**Companion doc:** `docs/SETTINGS-PLACEMENT-DESIGN.md` (2026-10-13, Phase-1 placement) — §4 of this spec **supersedes its placement recommendation** because Meheldi has since mandated killing the "More" buried-modules pattern in favor of 6 cockpit-style category buttons on home. Its port-vs-drop analysis (§4 of that doc) is largely adopted here, with deltas noted.

---

## 1. What Pookie had — full inventory with file references

### 1a. d-dash-app (dawsonkamal.com, production — what Meheldi actually used)

| # | Surface | File | What it controlled |
|---|---------|------|-------------------|
| 1 | **Preferences store** | `src/lib/preferences.ts` | Supabase `user_preferences` table (`user_id` PK, `settings` JSONB, `updated_at`) + localStorage fast cache. Keys: `homeOrder`, `questsOrder`, `playOrder`, `meOrder` (dashboard card/tab arrangement per device), `reduceMotion`, `celebrations`, `dailyReminder`, `updatedAt`. Debounced 400 ms saves, last-write-wins merge (server wins ties), graceful localStorage-only fallback when the table is missing. |
| 2 | **Teen settings sheet** (the only real settings UI in production) | `src/components/teen/tab-bar.tsx` → `SettingsView` (line 738) | Three toggles with plain-English sub-copy: **"Reduce motion"** — "Calms animations across the app" · **"Celebrations"** — "Confetti and XP reward popups" · **"Daily reminder"** — "A nudge to check in each day". Reached via Menu → Settings in the teen bottom sheet. |
| 3 | **Parent menu** | `src/components/nav/section-nav.tsx` | Full-page menu takeover: Ask Pookie entry, **appearance toggle** (`ThemeToggle`), **school portals** link list, **sign out**. |
| 4 | **Teen menu** | `src/components/teen/tab-bar.tsx` (line ~680) | `SyncSection` (manual sync w/ terminal log), ACCOUNT group: **Profile** (→ `/me`), **Settings** (→ the sheet above), **Sign out**. Email shown under the Menu header. |
| 5 | **Teen profile** | `src/components/teen/me-view.tsx` (+ `/me` route) | Profile view w/ sign-out. |

**Meheldi's footprint here:** the 3-toggle sheet pattern (label + one-line "what this does") is the direct ancestor of his plain-English rule; `ThemeToggle` existed because light/dark both shipped. He used the menu mostly for portals + sign out.

### 1b. pookie-app (the Oct 11–12 rebuild — richer, parent-centric, abandoned)

**Settings hub** — `src/components/settings/`:
- `settings-ui.tsx` — shared shell: `SettingsTabs` (sub-nav), `SettingsCard`, `Field`, `inputClass`, `PrimaryButton`, `DangerButton`, `BackendPending` (honest "coming online" state — the never-blank-pages pattern), `ParentOnlyNotice`.
- `settings-view.tsx` — **parent** settings home. Cards: **Profile** (email read-only, editable name); **Children** (add/edit/archive: firstName/lastName required, nickname, school, grade level, birthdate → age-tier protections); **Notifications** — `NotificationPrefs` (`src/lib/management-api.ts:253`): `sync_complete`, `grade_drop`, `due_soon`, `weekly_digest` toggles + `quiet_hours_start`/`quiet_hours_end` (time inputs); **Session** (sign out w/ dead-man's-switch: 15 s timeout forces `/login`); `DangerZone` (delete account: modal with plain-language consequences → type-to-confirm → **30-day grace** soft-delete → purge date shown).
- `child-settings-view.tsx` — **teen (13–17) scoped** panel (Meheldi 2026-10-12 scope decisions, in-file comment): My profile (nickname edit, avatar initial, "Photo avatars aren't available yet"), Check-in reminders (probed; read-only honest state), **Pookie AI tone picker** (`pookie` / `balanced` / `muse` — "Warm and encouraging — like a friend cheering you on" / "Friendly but to the point" / "Direct and no-fluff — straight answers, fast"), localStorage-backed labeled **"on this device"**, Session (sign out), and the line *"Family, billing, and data controls live with your parent — ask them if you need a change there."*
- Settings tabs (all parent): **Profile · Family · Sharing · Sync · Workers · School Logins** (`settings-ui.tsx` `SettingsTabs`; routes at `src/app/c/[childSlug]/settings/{family,sharing,sync,credentials,health}`).

**Family** — `family-view.tsx`: family members list, **invite child to log in** (email form; plain-English error map — e.g. "That email doesn't look right — check it and try again."), pending invites w/ resend/revoke, remove-child (`account/remove-child-section.tsx`: type child's first name → 30-day grace; if the child has their own login, "remove" removes the caller's *access grant*, not the child — child access-authority rule), **independence/"go independent"** (`independence-view.tsx`: 18+ gated, type `INDEPENDENT`, double-confirm, irreversible, *nothing deleted* — graduation with confetti framing).
**Sharing** — `sharing/page.tsx` + `health/sharing-health-view.tsx`: "Who Can See My Stuff?" per-tier per-parent toggles, hide-past lever, **sharing-history audit**, `VillageCrew`, `ParentalConsentPanel` (under-13), and the locked copy line: *"You decide. Change anything, anytime. Pookie never tells anyone when you change a setting here."* Other domains (location etc.) rendered as honest collapsed states.
**Sync** — `sync/console-view.tsx`: live sync-run history (timestamp, source, machine, records, success/failure, duration), terminal aesthetic, filterable by source (`parentvue`, `studentvue`, `ctls-parent`, `ctls-learn`, `gmail-teacher`, `ccsd-calendar`, `checkin-app`), **per-source "Sync Now"** triggers, live `sync_jobs` queue underneath.
**School Logins** — `sync/logins-view.tsx`: 4 portals (`management-api.ts:178–185`: `studentvue` "StudentVUE (Cobb)", `parentvue` "ParentVUE (Cobb)", `ctls-learn` "CTLS Learn", `o365` "Microsoft 365 school login"); per-portal health — **Connected / Needs Attention / Not Configured**; username masked, **password write-only (never displayed, never returned by the API)**; test-connection buttons; remove. Secure-Vault-backed.
**Workers** — `sync/workers-view.tsx`: agent heartbeat cards (system health).
**Check-in retention** — `api/v1/children/[childId]/school/checkin-settings/route.ts` + `server/services/calibration.ts`: `checkin_retention` ∈ `rolling_90d` (default) / `rolling_365d` / `manual_delete_only`; **teen-owned**, parent sees labeled read-only state.
**Cookie consent** — `components/cookies/preference-center.tsx`: device-level categories (necessary / analytics / functional / advertising), per-category toggles with explanations.
**Meal preferences** — `components/health/meals-preferences.tsx`: per-person likes / dislikes / allergen flags (explicit entry only; allergens warn on the week planner, never hard-block).

**Meheldi's footprint here:** the `role="switch"` toggle pattern; tri-state probing (skeleton → live fields → honest "isn't wired up yet"); dead-man's-switch sign-out; plain-English error map on invites; type-to-confirm on destructive actions; 30-day grace deletions; the AI tone picker (ancestor of Crystal/Fireball preferences); "Pookie never tells anyone when you change a setting here."

### 1c. Cockpit today (what exists, mostly schema, no settings UI)

No settings pages exist in `cockpit/src/app/` (routes today: `/`, `/login`, `/home`, `/auth`, `/invite`, `/admin`, `/api`). Settings-relevant schema already migrated:

| Migration | Settings-relevant columns/tables |
|---|---|
| `001_pilot_foundation.sql` | `pilots` (id, display_name, timezone), `pilot_integrations` (kind ∈ health/shopping/calendar/mail/school/bank/travel, provider, status ∈ connected/disconnected/error/expired, config JSONB), `crew_members` (opt-in children, birthdate → age tiers), `crew_access_grants` (`granted_by` ∈ crew_member/steward), `crew_school_links` (district, vault `username_ref`, `sync_status`, `last_synced_at`) |
| `006_weather_pilot_prefs.sql` | `pilots.home_location`, `home_lat`, `home_lon` (coarse, per D7), `weather_units` ∈ F/C (default F) |
| `009_nudges.sql` | `nudge_preferences` (pilot PK; `categories` JSONB opt-out map; `min_score`; `quiet_hours_start/end` default **22:00–07:00**; `breakthrough_allowed` default false) |
| `020_school_reauth.sql`, `021_school_credential_types.sql`, `022_parentvue_extra_sections.sql` | school re-auth / credential types |
| `023_calendar_outlook.sql` | Outlook calendar connection |

**Known Meheldi values to seed as defaults** (from standing memory, not guesses): timezone `America/New_York`; home `Marietta, GA`; weather °F; notification quiet hours 22:00–07:00 (matches the 6 AM–10 PM teacher-email send window); grade-drop threshold **90**; weekly digest on; daily reminder on; celebrations on. The Azure "Cockpit" app (Calendars.ReadWrite) and the re-saved ParentVUE credential (Secure Vault, 2026-10-13 ~10:14 EDT) are the first two integrations to surface as "Connected."

---

## 2. Keep vs drop for Cockpit

**Adopted from `SETTINGS-PLACEMENT-DESIGN.md` §4** (keep): Profile basics; the `role="switch"` a11y toggle pattern; DangerZone delete with plain-English confirmation; School Logins reborn as a row inside Connections (re-auth flow, never raw passwords); the honest "not connected yet" state everywhere; sync freshness slimmed to a **single "last synced Xh ago" line** per integration row.

**Deltas from that doc's drop list (re-examined for this spec):**
- **Sync Console + Worker Health → moved out of pilot settings** (agreed) — but not dropped. The full terminal console belongs on a **support/admin ops surface** (the 7th menu category's agent-backend side per the 2026-10-12 support decisions), and a slim "Data & sync health" row can live inside Connections → school row → details. Meheldi runs syncs from his laptop and watches them; burying the console entirely would remove his operational view. It just must never sit next to "change your name."
- **Family / Sharing / Independence → keep the *capabilities*, move the *location*.** The pilot-first architecture is right (child features live in the feature menu, not registration). But access grants, per-child school logins + re-auth, and the sharing-history audit are core to a pilot with children — they belong in settings as **Family & Sharing**, child-scoped rows, not as a dead parent tab. "Go independent" stays a graduation flow launched from the child's row.
- **Check-in retention (rolling_90d/365d/manual)** → keep, teen-owned, surfaced on the teen's own row (read-only labeled state for the pilot when the teen owns it).
- **Cookie preference-center → keep**, but only on web/device surfaces, inside Privacy & Data, labeled "On this device."
- **Meal preferences (likes/dislikes/allergens) → drop from settings**; it belongs to the Health module, not global settings.
- **d-dash card-order prefs (`homeOrder`, `meOrder`…)** → reborn as **cockpit layout customization** (§5, new) — this is the layer-2 personalization gap.
- **AI tone picker → keep and expand** into full Crystal preferences (§5).
- **ThemeToggle (light/dark) → drop as a binary.** Cockpit is dark-cockpit-locked; replace with *dark-cockpit variants* (neon accent choice) + reduced motion + celebrations.

---

## 3. Redesigned settings structure — the instrument stations

**Form:** one Settings applet (overlay; toolbar persists beneath; ✕ close top-right; ‹ back chevron inside sections; Home exit). Home = single scrolling list of section rows, iOS-pattern: icon + plain-English title + one-line "what this does" + chevron + status summary on the right (e.g. "3 connected", "Quiet 10 PM–7 AM").

**Visual language (Cockpit theme):**
- Dark **black** instrument panels (`#050607`-ish surfaces, never navy/gray); hairline borders with faint neon edge-light.
- Subtle neon accents: **cyan** (primary/interactive), **teal** (connected/healthy), **green** (success), **amber** (attention — never red for status; red reserved *only* for the irreversible DangerZone), **white** (primary text), **purple** (Crystal/AI surfaces).
- Status lights: small glowing dots (teal = connected, amber = needs attention, dim slate = not connected) — the command-center idiom, reused from pookie's `StatusLight`.
- Toggles: `role="switch"`, cyan glow when on.
- Every setting = **label + one-line plain-English explanation** (grandmother test, Meheldi's rule). No setting without its explanation.
- Honest states: skeleton while loading → fields; unconnected rows say **"Not connected yet"**; unfinished backends say **"Still being built — nothing is broken"** (never blank pages, never dead toggles).
- Destructive actions: plain-language consequence modal → type-to-confirm → 30-day grace, same as pookie's DangerZone.
- Copy voice for headers: spacecraft framing is fine ("your ship"), but **labels stay plain English**. "Settings", not "Pilot Console" — the gear glyph carries the meaning.

### Station 1 — Your profile
*"Your name, email, and photo — how you show up."*
| Setting | Type | Plain-English description | Notes |
|---|---|---|---|
| Display name | text field | "The name Cockpit and Crystal use when talking to you." | → `pilots.display_name` |
| Email | read-only | "Your sign-in email. This can't be changed here." | From auth; honest locked state |
| Profile photo | upload | "A photo for your pilot chip. Stored privately, never shared." | pookie had avatar placeholder; now real |
| Time zone | picker | "Cockpit uses this for quiet hours, briefings, and reminders." | → `pilots.timezone`; default America/New_York |
| Home location | coarse picker | "City or ZIP only — never your exact address. Used for weather on your home screen." | → `home_location` + rounded lat/lon (D7 coarse rule, shown in the description) |
| Temperature units | °F / °C segmented | "How temperatures show on your home screen." | → `weather_units`, default °F |

### Station 2 — Connections
*"The outside services that feed your cockpit. Nothing connects unless you say so."*
Each row: service icon + name + status light + **"Last synced Xh ago"** freshness line + chevron. Detail panel: connect/disconnect, re-authenticate, per-service options, remove.
| Integration | Plain-English description | Cockpit status |
|---|---|---|
| Google Calendar | "Your events show up in Today and on the home screen." | schema ready (`pilot_integrations`) |
| Outlook calendar | "Your Microsoft calendar, same as above." | Azure "Cockpit" app registered 2026-10-13; **surface as first-class, default expected-connected** |
| Gmail | "Crystal can read mail for bills, receipts, and teacher emails." | schema ready |
| School portal (per child) | "Pulls {child}'s grades and attendance. If the school password changes, reconnect here." | ParentVUE/StudentVUE re-auth flow (migrations 020–022); password **never displayed** — re-enter only; status Connected / Needs Attention / Not Connected; per-portal **Test** button (from pookie's logins-view) |
| Health (Apple Health / Health Connect) | "Steps, sleep, and workouts feed your health station." | skills exist; OAuth surface TBD — honest "coming soon" state |
| Bank / cards | "Balances and spending for the money station." | later; honest state |
| Shopping (Amazon/Walmart) | "Order tracking for the shopping station." | later; honest state |
| Travel | "Flights and trips." | later; honest state |

Per-service options live here too (e.g. which Gmail labels Crystal may read; which calendars sync). **The full sync terminal + worker heartbeats are NOT here** — a "Data & sync health" link at the bottom of this station deep-links to the support/ops surface.

### Station 3 — Alerts
*"What Cockpit tells you about, and when it stays quiet."* (→ `nudge_preferences`)
| Setting | Type | Plain-English description |
|---|---|---|
| Alert categories | per-category switches: School grades, Bills, Calendar, Health, Shopping, Travel, Weekly digest | "Turn off any kind of alert. Off really means off — we never sneak one through." (opt-out map; absent = on — the no-dark-patterns rule from the schema comment) |
| Grade alerts | switch + threshold | "Tell me when a class drops below ___." Default **90**, per Meheldi's standing goal. (pookie's `grade_drop`) |
| Assignment due soon | switch | "A heads-up before homework is due." (pookie's `due_soon`) |
| Daily reminder | switch | "One nudge a day to check in." (d-dash's `dailyReminder`, default on) |
| Quiet hours | start/end time | "Cockpit stays silent between these hours." Default **10:00 PM – 7:00 AM** |
| Urgent breakthrough | switch | "Let truly urgent alerts (like a bill due today) break through quiet hours. Off unless you say so." Default off |
| Alert sensitivity | slider | "Only tell me about the important stuff" ↔ "Tell me everything." (→ `min_score`) |

Note: teacher-email send window (6 AM–10 PM, quiet-hour holds) is a *comms* rule, not an alert rule — it stays documented on the class page, not duplicated here.

### Station 4 — Crystal (AI)
*"How Crystal talks to you, and what she's allowed to learn."* Purple-accented surfaces.
| Setting | Type | Plain-English description |
|---|---|---|
| Voice mode | Crystal / Fireball segmented | **"Crystal** — warm and encouraging, like a friend. **Fireball** — direct, no fluff, straight answers." (expands pookie's 3-tone picker; "balanced" retired — the two named modes are the product) |
| Proactive help | Off / Gentle / Eager | "Gentle: Crystal mentions things she notices. Eager: she rearranges your cockpit and nudges you first. Off: she only answers when asked." |
| Learn from my corrections | switch | "When you fix something Crystal did, she remembers it — only inside your account, never shared with anyone else." (layer-4 personalization; default on, per the no-cross-user-learning principle) |
| Memory scope note | static line | "Crystal's memory of you never leaves your account." — trust copy, not a toggle |

### Station 5 — Your cockpit (ship)
*"How your cockpit looks, moves, and celebrates."* (the reborn `user_preferences` + layout layer)
| Setting | Type | Plain-English description |
|---|---|---|
| Home stations | reorder list (6 category buttons) | "Drag to reorder the six stations on your home screen." (→ `cockpit_layouts`, the layer-2 gap) |
| Home hero widgets | multi-select | "Pick what shows on your opening screen: weather, today's calendar, to-dos, quote of the day." |
| Neon accent | swatches: cyan / teal / green / amber / purple / white | "The glow color for highlights across your cockpit." (dark-cockpit-locked; no light mode — Bright Bridge stays dead) |
| Reduce motion | switch | "Calms animations across the app." (d-dash's exact copy — it passed the grandmother test) |
| Celebrations | switch | "Confetti and reward popups when good things happen." Default on |
| Orb behavior | Calm / Lively | "How much Crystal's orb drifts around the screen. Calm keeps her mostly home in the toolbar." (encodes Meheldi's soothing-orb directive as a user control) |

### Station 6 — Family & sharing
*"The people in your cockpit, and who can see what."* Child-scoped rows; pilot-first (no parent/child role tabs — the *pilot* manages their crew).
| Setting | Type | Plain-English description |
|---|---|---|
| Crew member row (per child) | row → detail | "{Name}, {Grade} · {School}" — detail: nickname, school, grade, **school login status** (→ Connections re-auth), check-in retention (teen-owned: labeled "Managed by {name}" when the teen owns it), **"Go independent"** graduation flow (18+, type-to-confirm, nothing deleted) |
| Add a child | flow | "Add a child to your cockpit. You'll add their school login next." (feature-menu flow; settings row deep-links to it) |
| Who can see my stuff | rows per person + per-area switches | "You decide. Change anything, anytime. **Cockpit never tells anyone when you change a setting here.**" (pookie's locked copy) — per-area: health tiers, school, location (coarse only, per D7); **sharing-history audit** ("See every change you've made") |
| Second parent / family invites | invite form + pending list | "Invite another parent. They only see what the child allows." (child-access-authority: `granted_by` shown; a parent can't revoke another parent's child-granted access — shown as locked state) |
| Remove / archive | type-to-confirm | "Remove {name} from your cockpit. Their history is kept for 30 days in case you change your mind." |

### Station 7 — Privacy & data
*"What we keep, how long, and your way out."*
| Setting | Type | Plain-English description |
|---|---|---|
| Check-in & data retention | rolling_90d / rolling_365d / manual | "How long we keep daily check-ins: 90 days, a year, or until you delete them." (teen-owned variant labeled accordingly) |
| Download my data | button | "Get a copy of everything Cockpit has about you." |
| Cookie choices | per-category switches | "On this device: which cookies Cockpit may use." (necessary locked on; analytics/functional/advertising toggleable) |
| Sign out | button | "Sign out on this device." (dead-man's-switch pattern: never strands the user) |
| **Delete my account** | danger zone | "Delete your Cockpit account. We'll show you exactly what goes away first, you type to confirm, and everything is kept for 30 days in case you change your mind." (pookie's DangerZone: plain-language modal → type-to-confirm → 30-day grace → purge date) |

---

## 4. Placement — supersedes the "inside More" recommendation

**Why the old recommendation no longer applies:** `SETTINGS-PLACEMENT-DESIGN.md` (Phase 1) recommended Settings as a pinned footer row inside the More applet — explicitly because the 5-station toolbar map couldn't take a 6th key (shelf math at 320px, symmetry, frequency mismatch). All three of those arguments still hold. **But Meheldi has now killed the More pattern entirely** (2026-10-13): the 31 modules move to 6 cockpit-style category buttons on home. There is no More applet to pin a row to. Placement must be re-decided.

**Proposed placement (two entries, one primary):**
1. **Primary — gear key on the home hero.** The home screen's glass pane header (weather + calendar pane) gets a persistent **gear glyph + "Settings"** control, pinned top-right of the pane. Rationale: home is now the module hub (6 category buttons live there), so Settings belongs to the hub, not to any one category — it's cross-cutting (alerts span school, money, health). Two taps max from anywhere: Home → Settings. The gear passes the grandmother test (microwave, car dashboard, iPhone).
2. **Secondary — pilot avatar menu.** Tapping the pilot avatar/chip (already planned as a header element) opens a small menu: profile, Settings, sign out. This is the iOS/Android-native pattern and the best discoverability fallback.

**Explicitly not:** a 6th toolbar station key (the shelf-math and frequency arguments from the old doc still hold — monthly-use function, don't tax every glance); buried inside any one of the 6 category buttons (settings span categories — a pilot looking for notification quiet hours would never open "Money" first); a standalone 7th category button (it would dilute the 6-category rhythm of the day).

**Applet behavior** (carried over from the old doc, still valid): opens as an overlay applet at the applet layer; toolbar persists beneath; ✕ closes fully; ‹ back chevron navigates within; opening Settings lights no station rail (it's hub-level, not station-level). Internal search ("type to find a setting") is worth adding — with 7 stations, search beats scrolling; make "quiet hours" and "school login" top hits.

---

## 5. New settings Cockpit needs that Pookie didn't have

1. **Crystal vs Fireball voice mode** — Pookie had a 3-tone picker (pookie/balanced/muse); Cockpit's product has two named AI identities. Settings must expose the mode switch with plain-English characterizations.
2. **Proactive help level + learn-from-corrections** — the 4-layer personalization design (2026-10-13) needs user-visible controls: how eager Crystal is, and consent for behavioral learning (account-local only). No Pookie equivalent.
3. **Cockpit layout customization** — home station order, hero widget picks (the `cockpit_layouts` table exists; nothing writes to it — the biggest personalization gap). d-dash had card-order prefs; this is their rebirth.
4. **Orb behavior** — Meheldi's soothing-orb directive (drifts, settles home, never jarring) as a Calm/Lively user control.
5. **Neon accent choice** — dark-cockpit-locked theme needs *some* personal expression; accent swatches replace the old light/dark toggle.
6. **Alert categories for the full pilot life** — Pookie's four toggles (sync_complete, grade_drop, due_soon, weekly_digest) assumed a school app. Cockpit needs per-domain categories (bills, calendar, health, shopping, travel) + sensitivity slider + urgent-breakthrough opt-in — the `nudge_preferences` schema already supports this; the UI is new.
7. **Weather/home-location + units** — schema exists (`006`); no Pookie UI ever collected them.
8. **Per-service integration options** — which Gmail labels, which calendars (Pookie's portals were connect-or-not; Cockpit's `pilot_integrations.config` JSONB invites per-provider options).
9. **Sharing-history audit + grant-visibility** — Pookie had the audit for health; Cockpit needs it account-wide with `granted_by` provenance (child vs steward) visible.
10. **Download-my-data** — Pookie had delete; Cockpit should have export too (trust + compliance posture from the 2026-10-12 decisions).

---

## 6. Engineering notes for the build team (no code, just contracts)

- **Storage:** pilot-level → `pilots` columns + `nudge_preferences` + a `pilot_settings` JSONB table (rebirth of d-dash's `user_preferences`: merge rule last-write-wins, localStorage fast cache, debounced saves, graceful degradation). Crew/child-scoped → `crew_members` / `crew_school_links`. AI prefs → new `crystal_preferences` (or `pilot_settings` namespace). Layout → `cockpit_layouts`.
- **Never store:** raw passwords/tokens (Secure Vault refs only — the pookie logins-view rule); exact home coordinates (rounded, D7).
- **Role rule:** pilot settings have **no parent/child role tabs** — the role-gated tab concept dies with the parent-centric IA. The one exception is teen-owned data (check-in retention, check-in reminders): pilot sees a labeled read-only state ("Managed by {name}").
- **Every row needs its honest state:** skeleton → value; "Not connected yet"; "Still being built — nothing is broken." No blank panels, no dead toggles (Meheldi's no-blank-pages rule).
- **Accessibility:** `role="switch"` on all toggles (pookie pattern); labels + descriptions programmatically associated; reduced-motion respected by the settings UI itself.
- **Open questions:** (a) settings search inside the applet — recommended yes; (b) photo upload source for the avatar; (c) the ops home for the full sync terminal + worker heartbeats (Support module vs admin area) still needs an owner; (d) which alert categories ship at launch vs honest "later" states.

---

## 7. Source index (where everything above was found)

- d-dash-app: `src/lib/preferences.ts`; `src/components/teen/tab-bar.tsx` (SettingsView ~L738, menu ~L680); `src/components/nav/section-nav.tsx` (menu takeover, ThemeToggle, portals); `src/components/teen/me-view.tsx`
- pookie-app: `src/components/settings/{settings-ui,settings-view,child-settings-view,family-view,independence-view}.tsx`; `src/app/c/[childSlug]/settings/{page,family,sharing,sync,credentials,health}/page.tsx`; `src/components/sync/{logins-view,console-view,workers-view}.tsx`; `src/components/account/{danger-zone,remove-child-section}.tsx`; `src/lib/management-api.ts` (NotificationPrefs L253, portals L178–210); `src/app/api/v1/children/[childId]/school/checkin-settings/route.ts`; `src/server/services/calibration.ts` (retention); `src/components/cookies/preference-center.tsx`; `src/components/health/meals-preferences.tsx`; `src/components/health/sharing-health-view.tsx`
- cockpit: `supabase/migrations/{001_pilot_foundation,006_weather_pilot_prefs,009_nudges,020_school_reauth,021_school_credential_types,022_parentvue_extra_sections,023_calendar_outlook}.sql`; `src/app/{page,home,login}/`; `docs/SETTINGS-PLACEMENT-DESIGN.md`
