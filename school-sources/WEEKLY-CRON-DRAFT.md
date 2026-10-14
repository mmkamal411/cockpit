# WEEKLY CRON — register via cron.add (parent agent)

id: school-sources-freshness-check
title: Weekly school sources freshness check
schedule: weekly, Mondays 07:00 America/New_York
delivery: chat f84f9a7e-7552-42bd-9b99-16268177573c

Body:
**Weekly school sources freshness check (district-agnostic)**

Every Monday ~7:00 AM ET, re-verify every crew member's saved school links:
district calendar pages and bell schedule pages (any district, any school).

Run: `python3 ~/workspace/cockpit/school-sources/weekly-check.py`

The script (no edits needed):
1. Reads all `crew_school_sources` rows via the Supabase Management API
   (postgres role; `custom.supabase-mgmt` vault credential attached at runtime).
2. Fetches each saved URL (20s timeout) — reachability only, no parsing.
3. Writes `last_checked_at` / `check_status` / `check_note` back to the row.
4. If a child's sources are ALL unreachable: inserts ONE nudge for the pilot
   (kind + category `school`, dedup_key `school-source:<id>:broken`).
5. When a previously-broken source recovers: expires the old nudge.

Exit 0 = check ran. Exit 1 = DB unreachable — report plainly to Meheldi.
After the run: log one line to ~/memory/YYYY-MM-DD.md with the summary.
Stay silent otherwise — nudges surface problems. Do NOT retry failed fetches.
