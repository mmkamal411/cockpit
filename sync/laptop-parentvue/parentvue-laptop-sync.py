#!/usr/bin/env python3
"""
Cockpit ParentVUE Backup Sync Worker
=====================================
Runs on Meheldi's laptops (MacBook + Windows) as a BACKUP data source
for grades. The primary source is the student-side sync (Dawson's
Microsoft SSO via browser); this worker pulls from ParentVUE (parent
credentials via the mobile API) as a fallback.

Pulls ParentVUE gradebook via the mobile REST API (with SOAP fallback),
then pushes one row per sync to the Cockpit Supabase project
(public.crew_grade_syncs) with pull_method='parentvue-laptop'.

Credentials:
  - ParentVUE username/password: DPAPI-encrypted file
    (.parentvue-credentials.enc, created by store-credential.py).
    Decryptable from ANY Windows session (interactive, SSH, scheduled
    task) — no per-logon-session Credential Manager isolation.
    Legacy keyring entries are still honored as a fallback during
    the transition.
    - macOS: security add-generic-password -s "cockpit-parentvue"
  - Supabase URL/anon key, crew_member_id: parentvue-config.json
    (non-sensitive; credentials never in this file)

Auth policy: NEVER retry invalid credentials (Cobb logs every failed
AttemptLogin; repeated failures risk account lockout). Network/transport
errors retry with backoff. Auth failures abort the run immediately.
"""

import json
import os
import platform
import re
import subprocess
import sys
import traceback
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "parentvue-config.json"
LOG_PATH = HERE / "parentvue-sync.log"

sys.path.insert(0, str(HERE))
try:
    from telemetry.parentvue_pull import ParentVuePull, ParentVuePullError
    TELEMETRY_OK = True
except Exception as e:
    print(f"FATAL: telemetry library not available: {e}", file=sys.stderr)
    sys.exit(2)

DEFAULTS = {
    "supabase_url": "",
    "supabase_anon_key": "",
    "crew_member_id": "",
    "child_name_hint": "",
    "device_name": "",
    "parentvue_host": "parentvue.cobbk12.org",
}

KEYCHAIN_SERVICE = "cockpit-parentvue"
PULL_METHOD = "parentvue-laptop"


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}Z] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_config():
    cfg = dict(DEFAULTS)
    if not CONFIG_PATH.exists():
        raise RuntimeError(
            f"Missing config: {CONFIG_PATH}\n"
            "Copy parentvue-config.json.example and fill in the values.")
    raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    cfg.update(raw)
    missing = [k for k in ("supabase_url", "supabase_anon_key",
                           "crew_member_id") if not cfg.get(k)]
    if missing:
        raise RuntimeError(f"Config missing required keys: {missing}")
    return cfg


def get_parentvue_credentials():
    """Read ParentVUE (username, password) from the OS keychain."""
    system = platform.system()
    if system == "Darwin":
        return _get_macos_keychain()
    elif system == "Windows":
        return _get_windows_credential()
    raise RuntimeError(f"Unsupported platform for keychain: {system}")


def _get_macos_keychain():
    try:
        proc = subprocess.run(
            ["security", "find-generic-password",
             "-s", KEYCHAIN_SERVICE, "-g"],
            capture_output=True, text=True, timeout=15)
    except Exception as e:
        raise RuntimeError(f"macOS keychain lookup failed: {e}") from e
    if proc.returncode != 0:
        raise RuntimeError(
            "ParentVUE credentials not in macOS Keychain. Store with:\n"
            f'  security add-generic-password -s "{KEYCHAIN_SERVICE}"'
            ' -a "<username>" -w')
    m = re.search(r'"acct"<blob>="([^"]+)"', proc.stderr)
    if not m:
        raise RuntimeError("Could not parse username from keychain entry.")
    username = m.group(1)
    m2 = re.search(r'password: "([^"]*)"', proc.stderr)
    password = m2.group(1) if m2 else None
    if password is None:
        # Newer macOS prints password to stdout with -w; retry that way.
        # We already have the account; fetch password by account.
        proc2 = subprocess.run(
            ["security", "find-generic-password",
             "-s", KEYCHAIN_SERVICE, "-a", username, "-w"],
            capture_output=True, text=True, timeout=15)
        if proc2.returncode != 0:
            raise RuntimeError("Could not read password from keychain.")
        password = proc2.stdout.strip()
    if not username or not password:
        raise RuntimeError("Keychain entry incomplete.")
    return username, password


def _get_windows_credential():
    # Preferred: DPAPI-encrypted file (credential_store.py).
    # Works from ANY session: interactive, SSH, or scheduled task.
    try:
        from credential_store import load_credentials, credentials_exist
        if credentials_exist():
            return load_credentials()
    except RuntimeError:
        # Encrypted file exists but unreadable — fall through to legacy.
        pass
    except ImportError:
        pass
    # Legacy: Python keyring (Windows Credential Manager).
    # NOTE: per-logon-session — invisible to scheduled tasks/SSH.
    try:
        import keyring
        username = keyring.get_password(KEYCHAIN_SERVICE, "username")
        password = keyring.get_password(KEYCHAIN_SERVICE, "password")
        # cmdkey stores as generic credential with target=service;
        # keyring may store under different naming. Try both.
        if not username:
            # Fallback: try reading via PowerShell CredentialManager module
            ps = (
                "$c = Get-StoredCredential -Target '" + KEYCHAIN_SERVICE + "' "
                "-ErrorAction SilentlyContinue; "
                "if ($c) { $c.UserName + \"`n\" + "
                "$c.GetNetworkCredential().Password }")
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive",
                 "-Command",
                 "Import-Module CredentialManager -ErrorAction Stop; " + ps],
                capture_output=True, text=True, timeout=30)
            if proc.returncode == 0 and proc.stdout.strip():
                lines = proc.stdout.strip().split("\n")
                if len(lines) >= 2:
                    return lines[0].strip(), lines[1].strip()
        elif username and password:
            return username, password
    except ImportError:
        pass
    except Exception:
        pass
    # Fallback: environment variables (documented, discouraged).
    env_u = os.environ.get("PARENTVUE_USERNAME")
    env_p = os.environ.get("PARENTVUE_PASSWORD")
    if env_u and env_p:
        log("WARNING: using env-var credentials (keychain preferred).")
        return env_u, env_p
    raise RuntimeError(
        "ParentVUE credentials not found. Store them once with:\n"
        "  python store-credential.py   (preferred, DPAPI-encrypted file)\n"
        "or: powershell -ExecutionPolicy Bypass -File store-credential.ps1")


def stage_payload(payload):
    """H2: Write the payload to a local staging file before pushing.

    Returns the Path of the staged file. The file is verified (valid JSON,
    non-empty grades) before returning. Callers push to Supabase only after
    staging succeeds.
    """
    staging_dir = HERE / "staging"
    staging_dir.mkdir(exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    staged_path = staging_dir / f"parentvue-sync-{ts}.json"
    # Verify minimum viable payload before writing.
    grades = payload.get("grades", [])
    if not grades:
        raise RuntimeError("Refusing to stage empty payload (C1 gate).")
    staged_path.write_text(
        json.dumps(payload, indent=2, default=str), encoding="utf-8")
    # Verify round-trip.
    roundtrip = json.loads(staged_path.read_text(encoding="utf-8"))
    if not roundtrip.get("grades"):
        raise RuntimeError("Staged payload failed verification.")
    log(f"Payload staged: {staged_path} ({len(grades)} classes)")
    return staged_path


def push_to_supabase(cfg, payload):
    """Push one sync row via rpc_push_crew_grade_sync (anon key)."""
    url = cfg["supabase_url"].rstrip("/") + "/rest/v1/rpc/rpc_push_crew_grade_sync"
    body = json.dumps({"p_data": payload}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "apikey": cfg["supabase_anon_key"],
            "Authorization": f"Bearer {cfg['supabase_anon_key']}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        })
    last_err = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:300]
            last_err = f"HTTP {e.code}: {detail}"
            if e.code in (400, 401, 403):
                break
        except Exception as e:
            last_err = str(e)[:200]
        import time as _t
        _t.sleep(2 ** attempt)
    raise RuntimeError(f"Supabase push failed: {last_err}")


def heartbeat(cfg, status):
    """Best-effort heartbeat: update crew_school_links sync_status."""
    try:
        url = (cfg["supabase_url"].rstrip() +
               "/rest/v1/crew_school_links?crew_member_id=eq." +
               cfg["crew_member_id"])
        body = json.dumps({
            "sync_status": status,
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
        }).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, method="PATCH",
            headers={
                "apikey": cfg["supabase_anon_key"],
                "Authorization": f"Bearer {cfg['supabase_anon_key']}",
                "Content-Type": "application/json",
            })
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:
        log(f"heartbeat failed (non-fatal): {e}")


def acquire_lock():
    """H5: Prevent concurrent pulls via a PID lockfile.

    Returns a file handle holding the lock, or None if another instance
    is running. Uses fcntl on Unix, msvcrt on Windows.
    """
    lock_path = HERE / "parentvue-sync.lock"
    try:
        f = open(lock_path, "w")
        if platform.system() == "Windows":
            import msvcrt
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                f.close()
                return None
        else:
            import fcntl
            try:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                f.close()
                return None
        f.write(str(os.getpid()))
        f.flush()
        return f
    except Exception:
        return None


def run_sync():
    # H5: refuse to run concurrently with another instance.
    _lock = acquire_lock()
    if _lock is None:
        log("Another sync is already running — skipping this run.")
        return 5
    # School-day guard: skip weekends (Sat=5, Sun=6). The scheduler fires
    # hourly on weekdays; this is a backstop for misconfigured schedules.
    # Holidays are not filtered — a no-change pull is harmless.
    weekday = datetime.now().weekday()
    if weekday >= 5:
        log("Weekend — skipping ParentVUE pull (school days only).")
        return 0
    cfg = load_config()
    username, password = get_parentvue_credentials()
    log(f"Starting ParentVUE backup pull (user={username[:3]}***)")
    heartbeat(cfg, "syncing")

    pull = ParentVuePull(
        username, password,
        child_name_hint=cfg.get("child_name_hint", ""),
        timeout=30, max_attempts=3)
    try:
        pull.login()
    except ParentVuePullError as e:
        heartbeat(cfg, "auth_error")
        log(f"AUTH FAILED — aborting (no retry): {e}")
        return 3

    result = pull.pull_all()
    gb = result["sections"].get("gradebook") or {}
    classes = gb.get("classes", [])

    # C1: minimum-viable-payload gate. Never push an empty gradebook —
    # it would silently erase good data in Supabase.
    if not classes:
        heartbeat(cfg, "error")
        log("ABORT: gradebook pull returned zero classes "
            f"(transport={result['transport']}, "
            f"errors={result['errors']}). Not pushing empty data.")
        return 4

    grades = []
    class_details = []
    for c in classes:
        grades.append({
            "class": c.get("class", ""),
            "grade": c.get("grade"),
            "period": c.get("period", ""),
        })
        class_details.append({
            "class": c.get("class", ""),
            "grade": c.get("grade"),
            "letter": c.get("letter", ""),
            "period": c.get("period", ""),
            "teacher": c.get("teacher", ""),
            "categories": c.get("categories", {}),
            "assignments": c.get("assignments", [])[:50],
            "assignment_count": c.get("assignment_count", 0),
        })

    # Due-next: ungraded/missing assignments due soon (best-effort).
    due_next = []
    for c in classes:
        for a in c.get("assignments", []):
            if a.get("score") is None and a.get("due"):
                due_next.append({
                    "assignment": a.get("title", ""),
                    "due": a.get("due", ""),
                    "class": c.get("class", ""),
                })
    due_next = due_next[:30]

    payload = {
        "crew_member_id": cfg["crew_member_id"],
        "device_name": cfg.get("device_name") or
                       f"{platform.node()}-parentvue",
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "grades": grades,
        "gpa": {},
        "due_next": due_next,
        "past_periods": [],
        "synergy_mail": [],
        "office365_emails": [],
        "class_details": class_details,
        "ctls_syllabi": {},
        "attendance": {},
        "ctls_announcements": [],
        "ctls_upcoming": [],
        "zero_guard_flags": [],
        "pull_method": PULL_METHOD,
    }

    # H2: Local staging — write payload to disk first, verify it, then push.
    # If the push fails, the staged file survives for manual retry/inspection.
    staged_path = stage_payload(payload)
    new_id = push_to_supabase(cfg, payload)
    # Push succeeded — archive the staged file.
    try:
        staged_path.rename(staged_path.with_suffix(".pushed.json"))
    except Exception:
        pass
    heartbeat(cfg, "ok")
    log(f"ParentVUE pull ok: {len(classes)} classes, "
        f"{sum(len(c.get('assignments', [])) for c in classes)} assignments, "
        f"transport={result['transport']}, row={new_id}")
    if result["errors"]:
        for e in result["errors"]:
            log(f"  section warning: {e['section']}: {e['error'][:120]}")
    return 0


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--sync-now", action="store_true")
    ap.add_argument("--check-credentials", action="store_true",
                    help="Verify keychain credentials exist (no pull).")
    args = ap.parse_args()
    try:
        if args.check_credentials:
            u, _ = get_parentvue_credentials()
            print(f"OK: credentials found for user {u[:3]}***")
            return 0
        return run_sync()
    except RuntimeError as e:
        log(f"ERROR: {e}")
        return 2
    except ParentVuePullError as e:
        log(f"AUTH ERROR: {e}")
        return 3
    except Exception:
        log("UNEXPECTED ERROR:\n" + traceback.format_exc())
        return 1


if __name__ == "__main__":
    sys.exit(main())
