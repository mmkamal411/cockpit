# Data Audit Report — School Data Sources

**Date:** 2026-10-13 · **Auditor:** Data Audit Coordinator + 3 sub-teams
**Scope:** All 5 school data sources for Meheldi's Cockpit project
**Method:** Read-only research. No live logins attempted by auditors (no credentials, Conditional Access blocks VM).

---

## Executive Summary

The current ParentVUE sync pulls **~15% of available data**. The biggest wins are embarrassingly close:

1. **Fetched-but-dropped:** The sync already calls 6 ParentVUE API sections but only maps 2 into the payload. Attendance, messages, calendar, schedule, and student_info are fetched and thrown away. (Fix: ~1 hour.)
2. **Wrong method names:** The code probes legacy SOAP method names on the JSON API. Four sections (messages, attendance, calendar, student_info) likely fail silently because of this. (Fix: ~2 hours.)
3. **Untouched API surface:** ~50 PXPWebServices methods exist; the sync calls 7. The SynergyMail family (18 methods — in-portal teacher email), Documents (report cards/transcripts as PDFs), and HW notes are all available but untouched.
4. **ParentSquare puller built, never run:** A complete CTLS Parent (now ParentSquare) puller exists but has never run with live credentials.
5. **Student-side blocked on laptop:** StudentVUE student-mode, CTLS Learn, and Office 365 all require the trusted laptop (Conditional Access 53003). Office 365 additionally blocked on Azure app registration (Meheldi's action item).

---

## Source 1: ParentVUE (parentvue.cobbk12.org)

**Access:** Mobile JSON API (primary) + SOAP (fallback). Works from anywhere — no Conditional Access block.
**Credentials:** Meheldi's parent login (Secure Vault).

### What the API provides (~50 methods)

| Category | Methods | Currently pulled? |
|---|---|---|
| Auth | AttemptLogin, RefreshToken, GetChildListData | ✅ |
| Gradebook | Gradebook (per-quarter via `reportPeriod` param) | ✅ (default quarter only) |
| Schedule | StudentClassList, GetStudentClasesForGivenDay, GetStudentClassTime | ✅ StudentClassList only |
| Attendance | GetStudentAttendanceList, GetStudentPastAttendanceData | ⚠️ Probed with wrong name |
| Messages (portal alerts) | GetPXPContentMessage | ⚠️ Probed with wrong names |
| **SynergyMail (teacher email)** | **18 methods** (conversations, messages, attachments, contacts, staff lists) | ❌ Entire family untouched |
| Student info | GetStudentInfoData | ⚠️ Probed with wrong name |
| Calendar | GetCalendarData | ⚠️ Probed with wrong name |
| **Documents** | **GetStudentDocuments + GetStudentDocumentContent** (report cards, transcripts as base64 PDFs) | ❌ |
| **HW notes** | **GetStudentHWNotes** (teacher homework notes) | ❌ |
| **Fees** | **GetStudentFeeData** (paid/outstanding) | ❌ |
| Discipline | GetStudentDisciplineData | ❌ |
| Health | GetHealthData (visits/immunizations/conditions) | ❌ |
| School info | GetSchoolInformationData (staff directory) | ❌ |
| Lunch | GetLunchOrderInfoResponse | ❌ |
| Conferences | GetConferenceData | ❌ |
| Acknowledgements | GetAckData family | ❌ |

### Critical bug: wrong method names on JSON API

The code probes **legacy SOAP names** on the new JSON API:
- `StudentInfo` → should be `GetStudentInfoData`
- `StudentCalendar` → should be `GetCalendarData`
- `Messages`/`GetMessages`/`GetPXPMessages` → should be `GetPXPContentMessage`
- `Attendance`/`GetAttendance` → should be `GetStudentAttendanceList`

These sections likely fail silently on every run.

### Critical bug: fetched but dropped

`pull_all()` fetches 6 sections. `run_sync()` only uses `gradebook`. These are **fetched and discarded**:
- `attendance` → payload has `"attendance": {}`
- `messages` → payload has `"synergy_mail": []`
- `calendar` → not mapped anywhere
- `schedule` → not mapped anywhere
- `student_info` → not mapped anywhere

### Schema fields always empty (ParentVUE could fill)

- `gpa` = `{}` — Gradebook has GPA data
- `past_periods` = `[]` — Gradebook supports per-quarter via `reportPeriod` param
- `synergy_mail` = `[]` — SynergyMail family untouched
- `attendance` = `{}` — fetched but dropped

---

## Source 2: CTLS Parent → ParentSquare (ctlsparent.cobbk12.org)

**Access:** Now redirects to ParentSquare. Internal `/api/v2/*` JSON endpoints with session cookies.
**Credentials:** Same as ParentVUE (shared session observed).

### What it provides
- School/teacher posts feed, notices, alerts
- Parent↔teacher direct + group messages
- Staff directory
- Student class sections (roster cross-check)
- Assessment results tab (currently "No data available" for Dawson)
- View-only "classroom access mode" into CTLS Learn (assessments observed empty)

### Status
A **complete puller already exists** (`dawson-grades/telemetry/parentsquare_pull.py` + `run_parent_pull.py`) implementing form login → `/api/v2/*` → staging → Supabase sink. **It has never run with live credentials.** Two auth questions remain: does the tenant accept email/password or force SSO, and is MFA on?

### Schema mapping
- ParentSquare feeds/notices → `ctls_announcements`
- Feed event items → `ctls_upcoming`

---

## Source 3: StudentVUE — Student Mode (studentvue.cobbk12.org)

**Access:** ❌ VM blocked (Conditional Access 53003). ✅ Trusted laptop only.
**Credentials:** dawson.kamal@students.cobbk12.org (Secure Vault).

### What it provides (beyond parent view)
- Fresher grades (student view updates before ParentVUE)
- **Real category weights** via read-only gradebook detail
- Per-assignment rows with full detail
- Class schedule, attendance detail, student profile
- In-portal Synergy mail

### Unverified
Whether Cobb's Microsoft SSO students can use the native mobile API (`AttemptLogin` with username/password). The laptop must test this; browser-SSO sweep remains the fallback.

### Schema mapping
- Student grades → `grades`, `class_details` (dual-source merge: student wins current, parent wins official, flag >1.0pt diff)
- Real category weights → `class_details[].categories`
- Synergy mail → `synergy_mail`

---

## Source 4: CTLS Learn (Brightspace/D2L)

**Access:** ❌ VM blocked (SSO). ✅ Trusted laptop browser only. No native API path.
**Credentials:** Student SSO session.

### What it provides (per course)
- Announcements/news → `ctls_announcements`
- Calendar/upcoming → `ctls_upcoming`
- Syllabus content → `ctls_syllabi` (or `course_materials` — needs canonical decision)
- Grades, discussions, documents

### Status
No automation exists. Current practice: manual browser downloads → `organize-ctls.ps1` → `ctls-uploader.py` → Supabase. The Brightspace Valence API requires institution OAuth keys (not available to parents).

---

## Source 5: Office 365 / Outlook

**Access:** ❌ Blocked on **Azure app registration** (Meheldi's action item) — no Graph API access without it. Also CA-blocked from VM.
**Credentials:** Student account via Microsoft Graph (after Azure setup).

### What it provides
- Teacher emails → `office365_emails`
- School announcements, assignment notifications
- Calendar events

### Status
Nothing exists. `office365_emails` pushed as `[]`. Cannot build until Azure app registration is complete.

---

## Prioritized Implementation Checklist

### P0 — Fix what's broken (do first, ~3 hours total)

- [ ] **Fix 4 method-name probes** in `studentvue_api.py`: `GetStudentInfoData`, `GetCalendarData`, `GetPXPContentMessage`, `GetStudentAttendanceList` (keep legacy names as fallbacks)
- [ ] **Map fetched-but-dropped sections** into payload: attendance → `attendance`, messages → `synergy_mail`, calendar/schedule/student_info → new or existing fields
- [ ] **Wire SOAP fallback methods**: `GetPXPMessages`, `StudentInfo`, `StudentClassList`, `StudentCalendar` (stop hardcoding `messages: []`)
- [ ] **Re-sync cockpit telemetry** with dawson-grades hardening (credential XML-escaping, empty-gradebook gate, typed auth errors)

### P1 — High value, small effort (~1-2 days)

- [ ] **SynergyMail read family** → `synergy_mail` (in-portal teacher email — the comms blind spot)
- [ ] **GetStudentDocuments + GetStudentDocumentContent** → report cards, transcripts (base64 PDFs)
- [ ] **GetStudentHWNotes** → teacher homework notes per class
- [ ] **GetStudentFeeData** → school fees (feeds Bills section)
- [ ] **Run ParentSquare puller with live credentials** → `ctls_announcements`, `ctls_upcoming` (parent-side)

### P2 — Medium value (~1 day)

- [ ] **GetStudentDisciplineData** → parent monitoring
- [ ] **GetStudentClasesForGivenDay** → today's schedule (Today tab)
- [ ] **GetStudentClassTime** → current class / minutes remaining
- [ ] **GetStudentPastAttendanceData** → full-year attendance
- [ ] **GetSchoolInformationData** → staff directory (teacher contacts)
- [ ] **GetHealthData** (visits) → health tracking
- [ ] **TestSystemCall** → sync watchdog smoke test
- [ ] **GetLunchOrderInfoResponse** → lunch menus

### P3 — Laptop-side student work (needs trusted laptop)

- [ ] **Student-side browser-SSO sweep**: real category weights, fresh grades → dual-source merge
- [ ] **Probe mobile API candidates from laptop**: `StudentInfo`, `Messages`, `Attendance` (student mode)
- [ ] **CTLS Learn browser sweep**: announcements → `ctls_announcements`, upcoming → `ctls_upcoming`, syllabus → resolve `ctls_syllabi` vs `course_materials`
- [ ] **Synergy in-portal mail probe** (ride on student sweep)

### P4 — Blocked on Meheldi

- [ ] **Azure app registration** → unblocks ALL Office 365/Outlook work
- [ ] **ParentVUE credential re-save** → unblocks parent-side fallback pipeline
- [ ] **Schema decision**: `ctls_syllabi` vs `course_materials` canonical location
- [ ] **Write-path policy**: `UpdateStudentAbsence` (report absences from app) — needs explicit approval

### P5 — Later / product-gated

- [ ] Parent-teacher conference scheduling
- [ ] Annual acknowledgement forms
- [ ] OLR (online registration) packets
- [ ] Push notification plumbing

---

## Data Flow Map (Current vs Target)

```
CURRENT (ParentVUE laptop sync):
  ParentVUE API ──→ gradebook ──→ grades, class_details, due_next ──→ Supabase
                  ├─→ attendance ──→ DROPPED
                  ├─→ messages ──→ DROPPED
                  ├─→ calendar ──→ DROPPED
                  ├─→ schedule ──→ DROPPED
                  └─→ student_info ──→ DROPPED

TARGET:
  ParentVUE API ──→ gradebook ──→ grades, class_details, due_next, gpa, past_periods
                  ├─→ attendance ──→ attendance
                  ├─→ SynergyMail ──→ synergy_mail
                  ├─→ GetPXPContentMessage ──→ portal alerts
                  ├─→ documents ──→ report cards, transcripts
                  ├─→ HW notes, fees, discipline ──→ respective fields
                  └─→ calendar, schedule ──→ today/upcoming

  ParentSquare ──→ feeds, notices ──→ ctls_announcements, ctls_upcoming
                 └─→ messages ──→ parent-teacher comms

  StudentVUE (laptop) ──→ fresh grades + real weights ──→ dual-source merge
  CTLS Learn (laptop) ──→ announcements, upcoming, syllabi
  Office 365 (after Azure) ──→ office365_emails
```

---

## Standing Rules (apply to all future pull work)

1. **Read-only always.** No grade/assignment modifications. Write methods need Meheldi's explicit approval.
2. **Never retry invalid credentials.** Cobb logs every failed AttemptLogin. One attempt, fail loud.
3. **Student portals = laptop only.** No VM/egress attempts against `*.cobbk12.org` SSO endpoints.
4. **Provenance in `pull_method`.** Every snapshot records source (`'api'`, `'browser'`, `'parentvue-laptop'`) and device.
5. **No secrets in files.** Credentials in OS keychain / `.env.telemetry` (chmod 600), never plaintext configs.

---

*Full per-source detail in sub-team reports: `/tmp/parentvue-api-audit.md`, `/tmp/ctls-parent-audit.md`, `/tmp/student-side-audit.md`*
