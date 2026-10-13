#!/usr/bin/env python3
"""
One-time setup: encrypt and store the ParentVUE credentials with DPAPI.

Run ONCE on the Windows laptop, from ANY session (interactive
PowerShell, admin shell, etc.):

    python store-credential.py

Prompts for username/password, encrypts them with Windows DPAPI, and
writes .parentvue-credentials.enc next to this script. The sync worker
(and the scheduled task) decrypt the file from any session — no more
per-logon-session Credential Manager isolation.

To verify afterwards:
    python parentvue-laptop-sync.py --check-credentials
"""

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from credential_store import (
        store_credentials, load_credentials, credential_file_path,
    )
except ImportError as e:
    print(f"FATAL: credential_store module not found: {e}")
    sys.exit(2)

username = input("ParentVUE username: ").strip()
password = getpass.getpass("ParentVUE password: ")

if not username or not password:
    print("Username and password are required.")
    sys.exit(1)

try:
    scope = store_credentials(username, password)
except RuntimeError as e:
    print(f"FAILED: {e}")
    sys.exit(1)

# Verify round-trip immediately.
try:
    check_u, check_p = load_credentials()
except RuntimeError as e:
    print(f"FAILED: wrote the file but could not read it back: {e}")
    sys.exit(1)

if check_u == username and check_p == password:
    print(f"OK: encrypted credentials stored for "
          f"'{username[:3]}***' (scope={scope}).")
    print(f"File: {credential_file_path()}")
    print("Verify with: python parentvue-laptop-sync.py --check-credentials")
else:
    print("FAILED: round-trip verification mismatch.")
    sys.exit(1)
