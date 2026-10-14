"""
DPAPI credential storage for the ParentVUE sync worker (Windows).

Stores the ParentVUE username/password encrypted with Windows DPAPI
(CryptProtectData), so the encrypted file can be decrypted from ANY
session on this machine: interactive PowerShell, SSH, or a scheduled
task.

Why not Windows Credential Manager / keyring?
    Credential Manager is per-logon-session. Credentials stored from an
    interactive PowerShell are invisible to scheduled tasks and SSH
    sessions running as the same user, which broke the hourly sync.
    DPAPI machine scope has no such limitation.

Scope strategy:
    Machine scope is tried first (decryptable from any session, no
    profile load needed). If the process lacks permission for machine
    scope, it falls back to user scope (still works for scheduled
    tasks, which load the user profile). Decryption is scope-agnostic.

Security:
    - Machine scope means any local user on THIS machine can decrypt.
      Acceptable on a single-user family laptop; the file is also
      ACL'd to the current user as defense-in-depth.
    - NEVER plaintext: the file holds only the DPAPI blob.
    - Passwords never appear in logs or error messages.
"""

import ctypes
import json
import os
import platform
import subprocess
from ctypes import wintypes
from pathlib import Path

CRED_FILE_NAME = ".parentvue-credentials.enc"

# CryptProtectData dwFlags
_CRYPTPROTECT_LOCAL_MACHINE = 0x4
_CRYPTPROTECT_UI_FORBIDDEN = 0x1

# Win32 ERROR_ACCESS_DENIED
_ERROR_ACCESS_DENIED = 5


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


def _load_libs():
    if platform.system() != "Windows":
        raise RuntimeError("DPAPI credential storage requires Windows.")
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    crypt32.CryptProtectData.argtypes = [
        ctypes.POINTER(_DATA_BLOB), wintypes.LPCWSTR,
        ctypes.POINTER(_DATA_BLOB), wintypes.LPVOID, wintypes.LPVOID,
        wintypes.DWORD, ctypes.POINTER(_DATA_BLOB),
    ]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    crypt32.CryptUnprotectData.argtypes = [
        ctypes.POINTER(_DATA_BLOB), ctypes.POINTER(wintypes.LPWSTR),
        ctypes.POINTER(_DATA_BLOB), wintypes.LPVOID, wintypes.LPVOID,
        wintypes.DWORD, ctypes.POINTER(_DATA_BLOB),
    ]
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel32.LocalFree.restype = wintypes.HLOCAL
    return crypt32, kernel32


def _blob_from(data: bytes):
    """Build a DATA_BLOB; returns (blob, keepalive_buffer)."""
    buf = ctypes.create_string_buffer(data)
    blob = _DATA_BLOB()
    blob.cbData = len(data)
    blob.pbData = ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte))
    return blob, buf


def dpapi_encrypt(plaintext: bytes, machine_scope: bool = True) -> bytes:
    """Encrypt bytes with DPAPI. Returns the opaque blob."""
    crypt32, kernel32 = _load_libs()
    in_blob, _keep = _blob_from(plaintext)
    out_blob = _DATA_BLOB()
    flags = _CRYPTPROTECT_UI_FORBIDDEN
    if machine_scope:
        flags |= _CRYPTPROTECT_LOCAL_MACHINE
    ok = crypt32.CryptProtectData(
        ctypes.byref(in_blob), None, None, None, None,
        flags, ctypes.byref(out_blob))
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def dpapi_decrypt(ciphertext: bytes) -> bytes:
    """Decrypt a DPAPI blob. Scope is detected automatically."""
    crypt32, kernel32 = _load_libs()
    in_blob, _keep = _blob_from(ciphertext)
    out_blob = _DATA_BLOB()
    ok = crypt32.CryptUnprotectData(
        ctypes.byref(in_blob), None, None, None, None,
        _CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(out_blob))
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        kernel32.LocalFree(out_blob.pbData)


def credential_file_path() -> Path:
    return Path(__file__).resolve().parent / CRED_FILE_NAME


def credentials_exist() -> bool:
    return credential_file_path().exists()


def _restrict_permissions(path: Path) -> None:
    """Best-effort: ACL the file to the current user only."""
    try:
        user = os.environ.get("USERNAME", "")
        if not user:
            return
        subprocess.run(
            ["icacls", str(path), "/inheritance:r",
             "/grant:r", f"{user}:(R,W)"],
            capture_output=True, timeout=15)
    except Exception:
        pass


def store_credentials(username: str, password: str) -> str:
    """Encrypt and store credentials. Returns the scope used.

    Tries machine scope first (works from every session type); falls
    back to user scope on access-denied.
    """
    if not username or not password:
        raise ValueError("Username and password are required.")
    payload = json.dumps(
        {"username": username, "password": password}).encode("utf-8")
    try:
        blob = dpapi_encrypt(payload, machine_scope=True)
        scope = "machine"
    except OSError as e:
        if getattr(e, "winerror", None) != _ERROR_ACCESS_DENIED:
            raise
        blob = dpapi_encrypt(payload, machine_scope=False)
        scope = "user"
    path = credential_file_path()
    path.write_bytes(blob)
    _restrict_permissions(path)
    return scope


def load_credentials() -> tuple:
    """Decrypt and return (username, password)."""
    path = credential_file_path()
    if not path.exists():
        raise RuntimeError(
            f"Encrypted credential file not found: {path}\n"
            "Run store-credential.py once to create it.")
    try:
        raw = dpapi_decrypt(path.read_bytes())
        data = json.loads(raw.decode("utf-8"))
        username = data.get("username", "")
        password = data.get("password", "")
    except Exception as e:
        raise RuntimeError(
            f"Could not decrypt credential file: {e}") from e
    if not username or not password:
        raise RuntimeError("Credential file is incomplete; re-run setup.")
    return username, password
