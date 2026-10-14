# ParentVUE Backup Sync — Documentation

## Purpose
Backup grade data source via ParentVUE (parent credentials). The primary
source is the student-side sync (Dawson's Microsoft SSO via browser on the
laptops). This worker pulls from ParentVUE's mobile API as a fallback when
the student-side sync is stale or failing.

## Data Flow
```
ParentVUE (parentvue.cobbk12.org)
  → mobile REST API (AttemptLogin → Gradebook) — SOAP fallback
  → parentvue-laptop-sync.py (on MacBook / Windows laptop)
  → Supabase crew_grade_syncs (pull_method='parentvue-laptop')
  → Cockpit dashboard (reads latest sync per crew member)
```

## Files
- `parentvue-laptop-sync.py` — main worker (stdlib + telemetry/)
- `telemetry/` — ParentVUE API client (parentvue_pull.py, studentvue_api.py, http.py)
- `parentvue-config.json` — non-sensitive config (Supabase URL/key, crew UUID)
- `launchd/com.cockpit.parentvue-sync.plist` — macOS scheduling (hourly, school days)
- `windows-task/ParentVueSync.xml` — Windows Task Scheduler definition
- `windows-task/run-hourly.bat` — Windows hourly wrapper (weekend/hour guard)
- `credential_store.py` — DPAPI encrypt/decrypt module (Windows)
- `windows-task/store-credential.py` — one-time credential setup (DPAPI)

## Credentials
ParentVUE username/password are stored DPAPI-encrypted on Windows
(`.parentvue-credentials.enc`, created by `store-credential.py`) —
decryptable from ANY session (interactive, SSH, scheduled task).
On macOS they live in the Keychain. NEVER in config files.

Windows (run once on the laptop, any session):
```powershell
python windows-task\store-credential.py
# Verify:
python parentvue-laptop-sync.py --check-credentials
```

macOS (run on the MacBook):
```bash
security add-generic-password -s "cockpit-parentvue" -a "<username>" -w
# Verify:
python3 ~/parentvue-sync/parentvue-laptop-sync.py --check-credentials
```

Why DPAPI instead of Credential Manager? Credential Manager is
per-logon-session: credentials stored from interactive PowerShell are
invisible to scheduled tasks and SSH sessions running as the same user.
DPAPI machine scope has no such limitation.

## Scheduling
- **macOS**: launchd, hourly at :15 past, 6 AM–10 PM, Mon–Fri.
  The script also skips weekends internally as a backstop.
  Load: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cockpit.parentvue-sync.plist`
- **Windows**: Task Scheduler, hourly via `run-hourly.bat` wrapper
  (which enforces weekend + hour guards).
  Create: `schtasks /create /tn "Cockpit ParentVueSync" /xml ParentVueSync.xml`

## Auth Policy
NEVER retry invalid credentials. Cobb logs every failed AttemptLogin;
repeated failures risk account lockout. Auth failures abort immediately
(exit code 3). Network/transport errors retry with backoff.

## Supabase Push
Uses `rpc_push_crew_grade_sync(p_data jsonb)` with the anon key.
Sets `pull_method='parentvue-laptop'` so the dashboard can distinguish
backup pulls from primary student-side pulls.

## Status (2026-10-13)
- [x] Script written and syntax-checked
- [x] Deployed to MacBook (~/parentvue-sync/)
- [x] Deployed to Windows (~/parentvue-sync/)
- [x] macOS launchd plist installed (not yet loaded)
- [ ] ParentVUE credentials in keychains (needs Meheldi)
- [ ] crew_member_id in config (blocked: needs Meheldi sign-in → crew insert)
- [ ] Schedulers loaded/activated (after credentials + UUID are set)
- [ ] End-to-end test pull (after above)
