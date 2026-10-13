#!/usr/bin/env python3
"""Validate ParentVUE credentials with a single login attempt.

Used by the Cockpit web app's school re-auth flow. Reads credentials from
environment (never argv — argv is visible in process listings).

Env:
  REAUTH_USERNAME, REAUTH_PASSWORD

Exit codes:
  0  login succeeded
  1  auth rejected (bad username/password)
  2  any other failure (network, timeout, unexpected)

Prints only "ok", "auth_failed", or "error" to stdout. Never prints
credentials. Single attempt only — repeated bad logins risk locking the
school account (see cockpit-installer/SECURITY.md §4.3).
"""

import os
import sys

sys.path.insert(0, os.path.expanduser("~/workspace/dawson-grades"))

from telemetry.parentvue_pull import ParentVuePull, ParentVuePullError


def main() -> int:
    username = os.environ.get("REAUTH_USERNAME", "").strip()
    password = os.environ.get("REAUTH_PASSWORD", "")
    if not username or not password:
        print("error")
        return 2
    try:
        puller = ParentVuePull(
            username, password, timeout=25, max_attempts=1, transport="rest"
        )
        puller.login()
    except ParentVuePullError as e:
        # Auth failures raise ParentVuePullError with "auth failed" in message.
        # Anything else (network, timeout) is a transient error.
        msg = str(e).lower()
        if "auth failed" in msg or "invalid" in msg:
            print("auth_failed")
            return 1
        print("error")
        return 2
    except Exception:
        print("error")
        return 2
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
