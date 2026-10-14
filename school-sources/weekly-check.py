#!/usr/bin/env python3
"""Weekly school-source freshness check for Cockpit.

Re-verifies every crew member's saved district calendar + bell schedule URLs:
  1. Reads crew_school_sources (via the Supabase Management API, postgres role).
  2. Fetches each URL (20s timeout, desktop UA) — no parsing, just reachability.
  3. Writes last_checked_at / check_status / check_note back to the row.
  4. Surfaces broken sources to the pilot via a nudge (deduped; auto-expired
     when the source recovers).

No secrets in this file: the Management API credential comes from the vault
(custom.supabase-mgmt) at runtime, exactly like bin/sbmgmt.py.

Exit 0 = check ran (even if some sources are broken — that's what the nudges
are for). Exit 1 = the check itself couldn't run (DB unreachable).
"""
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import (
    add_surrogate_to_request,
    read_response_body,
    DynamicCredentialError,
)

MGMT_HOST = "api.supabase.com"
PROJECT_REF = "hwnesewathbnfvoxtbqh"
CREDENTIAL = "custom.supabase-mgmt"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) CockpitSchoolSourceCheck/1.0"


def mgmt_query(sql):
    """Run SQL against the Cockpit project via the Management API."""
    url = f"https://{MGMT_HOST}/v1/projects/{PROJECT_REF}/database/query"
    req = urllib.request.Request(
        url, data=json.dumps({"query": sql}).encode("utf-8"), method="POST"
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    add_surrogate_to_request(req, CREDENTIAL, allowed_hosts=[MGMT_HOST])
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        text = read_response_body(resp).decode("utf-8", errors="replace").strip()
        return json.loads(text) if text else []
    except urllib.error.HTTPError as e:
        detail = read_response_body(e).decode("utf-8", errors="replace")
        raise RuntimeError(f"management API HTTP {e.code}: {detail[:300]}")


def qlit(value):
    """Dollar-quoted SQL string literal (the mgmt endpoint is happier with these)."""
    if value is None:
        return "null"
    return "$$" + str(value).replace("$$", "") + "$$"


def fetch_url(url):
    """Return (ok, note). Reachability only — no content parsing."""
    if not url or not url.startswith(("http://", "https://")):
        return False, "This link doesn't look like a web address."
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            if 200 <= r.status < 300:
                return True, ""
            return False, f"The page answered with an error (status {r.status})."
    except urllib.error.HTTPError as e:
        return False, f"The page answered with an error (status {e.code})."
    except Exception:
        return False, "The school's website didn't answer. The link may have moved."


def main():
    try:
        rows = mgmt_query(
            "select ss.id, cm.pilot_id, cm.name as child_name, ss.district,"
            " ss.calendar_source_url, ss.bell_schedules"
            " from public.crew_school_sources ss"
            " join public.crew_members cm on cm.id = ss.crew_member_id"
        )
    except (DynamicCredentialError, RuntimeError) as e:
        print(f"school-source check failed: database unreachable ({e})")
        return 1

    if not rows:
        print("school-source check: no saved school sources to verify.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    summary = []
    for row in rows:
        sid = row["id"]
        pilot_id = row["pilot_id"]
        child = row.get("child_name") or "your child"
        district = row.get("district") or "their school district"

        targets = []
        if row.get("calendar_source_url"):
            targets.append(("calendar", "District calendar", row["calendar_source_url"]))
        bells = row.get("bell_schedules") or []
        if isinstance(bells, str):
            try:
                bells = json.loads(bells)
            except json.JSONDecodeError:
                bells = []
        for i, b in enumerate(bells or []):
            if isinstance(b, dict) and b.get("url"):
                targets.append(("bell", b.get("label") or f"Schedule {i + 1}", b["url"]))

        results = []
        for kind, label, url in targets:
            ok, note = fetch_url(url)
            results.append((kind, label, url, ok, note))

        ok_count = sum(1 for r in results if r[3])
        if not results:
            status, note = None, None
        elif ok_count == len(results):
            status = "ok"
            note = f"All {len(results)} school links checked on {now[:10]} and working."
        elif ok_count == 0:
            status = "broken"
            bad = ", ".join(r[1] for r in results)
            note = f"Couldn't reach: {bad}. The school's website may have moved these pages."
        else:
            status = "stale"
            bad = ", ".join(r[1] for r in results if not r[3])
            note = f"Mostly fine, but couldn't reach: {bad}."

        mgmt_query(
            "update public.crew_school_sources set"
            f" last_checked_at = {qlit(now)},"
            f" check_status = {qlit(status)},"
            f" check_note = {qlit(note)},"
            " updated_at = now()"
            f" where id = {qlit(sid)}"
        )

        # Nudge the pilot about broken sources (deduped; expire on recovery).
        dedup = f"school-source:{sid}:broken"
        live = mgmt_query(
            "select id from public.nudges where pilot_id = " + qlit(pilot_id) +
            " and dedup_key = " + qlit(dedup) +
            " and status not in ('expired','muted') limit 1"
        )
        if status == "broken" and not live:
            bad_labels = ", ".join(r[1] for r in results if not r[3])
            body = (
                f"Crystal couldn't open {child}'s {bad_labels.lower()} link"
                f" ({district}). The school may have moved the page —"
                " check the link in Crew > school sources when you get a moment."
            )
            mgmt_query(
                "insert into public.nudges"
                " (pilot_id, kind, category, title, detail, body, priority, score,"
                "  source, source_ref, dedup_key, status)"
                " values ("
                + qlit(pilot_id) + ", 'school', 'school',"
                + qlit("A school link needs attention") + ","
                + qlit(body) + "," + qlit(body) + ","
                + "'normal', 40, 'school',"
                + qlit(json.dumps({"crew_member_id": row["crew_member_id"], "source_id": sid}))
                + "::jsonb,"
                + qlit(dedup) + ", 'pending')"
            )
            summary.append(f"{child}: BROKEN ({bad_labels}) — nudge sent")
        elif status in ("ok", "stale") and live:
            mgmt_query(
                "update public.nudges set status = 'expired'"
                f" where id = {qlit(live[0]['id'])}"
            )
            summary.append(f"{child}: recovered — old nudge cleared")
        else:
            summary.append(f"{child}: {status or 'no links saved'}")

    print("school-source weekly check complete: " + "; ".join(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
