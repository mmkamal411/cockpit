#!/usr/bin/env python3
"""Post-deploy smoke test for Cockpit staging (cockpit.pages.dev).

Versioned from pookie-app/smoke-test-staging.py (2026-10-12).

Every check below is a REAL HTTP assertion against the live deployment —
no skipped checks, no TODOs. Each one must pass for the deploy to be
claimed healthy. Fails loudly (non-zero exit) if any check fails.

Usage:
    python3 smoke-test-staging.py [base_url]

Checks:
    GET /                            -> 200 or 307/308 (root serves or
                                        redirects; anything else fails)
    GET /login                       -> 200 + non-trivial HTML body
                                        (a 200 that renders the Next.js error
                                        boundary instead of the login page
                                        would slip past a status-only check;
                                        catches it by asserting a real page
                                        body)
    GET /auth/callback               -> 307 (no code = graceful redirect to
                                        login, never a 500)
    GET /videos/vista-planets-1.mp4  -> 200 + Content-Type starts with
                                        "video/" (proves the _routes.json
                                        exclusion serves videos straight
                                        from Pages, not via the worker)
    GET <first /_next/static asset referenced by /login>
                                     -> 200 (proves the _routes.json
                                        exclusion serves static assets;
                                        without it the OpenNext worker
                                        404s every static asset)

NOTE: the /login check requires the login page to exist. If the UI team
has not built it yet, this script FAILS on that check — that is by
design (fail loudly), not a pipeline bug.
"""
import re
import sys
import urllib.request
import urllib.error

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://cockpit.pages.dev"
UA = "Mozilla/5.0 (Cockpit-Smoke-Test) AppleWebKit/537.36"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Don't follow, let us inspect the 3xx


def fetch(method, path, data=None, headers=None):
    """Returns (status:int, body:bytes, headers). Never raises."""
    url = BASE + path
    opener = urllib.request.build_opener(NoRedirect)
    h = {"User-Agent": UA}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        resp = opener.open(req, timeout=20)
        return resp.status, resp.read(), resp.headers
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        return e.code, body, e.headers
    except Exception as e:
        return -1, str(e).encode(), {}


def fail(path, desc, detail):
    print(f"  FAIL {path}: {desc} — {detail}")
    return False


def ok(path, desc, detail=""):
    suffix = f" ({detail})" if detail else ""
    print(f"  OK   {path}: {desc}{suffix}")
    return True


def check_root():
    path, desc = "/", "root serves or redirects"
    status, body, _ = fetch("GET", path)
    if status == -1:
        return fail(path, desc, f"request error: {body.decode(errors='replace')}")
    if status >= 500:
        return fail(path, desc, f"SERVER ERROR {status} (never acceptable)")
    if status in (200, 301, 302, 307, 308):
        return ok(path, desc, f"got {status}")
    return fail(path, desc, f"got {status} (expected 200 or 3xx)")


def check_login():
    path, desc = "/login", "login page renders"
    status, body, _ = fetch("GET", path)
    if status == -1:
        return fail(path, desc, f"request error: {body.decode(errors='replace')}")
    if status >= 500:
        return fail(path, desc, f"SERVER ERROR {status} (never acceptable)")
    if status != 200:
        return fail(path, desc, f"got {status} (expected 200)")
    html = body.decode("utf-8", errors="replace")
    if "<html" not in html.lower():
        return fail(path, desc, "200 but body has no <html> (error boundary?)")
    if len(body) < 500:
        return fail(path, desc,
                    f"200 but body is only {len(body)} bytes (error page?)")
    return ok(path, desc, f"200, {len(body)} bytes HTML"), html


def check_callback():
    path, desc = "/auth/callback", "callback without code redirects gracefully"
    status, body, headers = fetch("GET", path)
    if status == -1:
        return fail(path, desc, f"request error: {body.decode(errors='replace')}")
    if status >= 500:
        return fail(path, desc, f"SERVER ERROR {status} (auth broken?)")
    if status in (301, 302, 307, 308):
        loc = headers.get("Location", "")
        return ok(path, desc, f"{status} -> {loc}")
    return fail(path, desc, f"got {status} (expected a redirect)")


def check_video():
    path, desc = "/videos/vista-planets-1.mp4", "space-loop video serves"
    status, body, headers = fetch("GET", path)
    if status == -1:
        return fail(path, desc, f"request error: {body.decode(errors='replace')}")
    if status != 200:
        return fail(path, desc,
                    f"got {status} (expected 200; _routes.json /videos/* broken?)")
    ctype = headers.get("Content-Type", "")
    if not ctype.startswith("video/"):
        return fail(path, desc,
                    f"200 but Content-Type is {ctype!r} (expected video/*)")
    return ok(path, desc, f"200, {ctype}, {len(body)} bytes")


def check_static_asset(html):
    desc = "static asset serves via Pages (_routes.json)"
    if html is None:
        return fail("(static)", desc, "skipped: /login HTML unavailable")
    m = re.search(r'["\'](/_next/static/[^"\']+\.(?:js|css))["\']', html)
    if not m:
        return fail("(static)", desc,
                    "no /_next/static asset reference found in /login HTML")
    path = m.group(1)
    status, body, _ = fetch("GET", path)
    if status == -1:
        return fail(path, desc, f"request error: {body.decode(errors='replace')}")
    if status == 200:
        return ok(path, desc, f"200, {len(body)} bytes")
    return fail(path, desc, f"got {status} (expected 200; _routes.json broken?)")


def main():
    print(f"Smoke test: {BASE}")
    results = [check_root()]

    login_res = check_login()
    login_html = None
    if isinstance(login_res, tuple):
        results.append(login_res[0])
        login_html = login_res[1]
    else:
        results.append(login_res)

    results.append(check_callback())
    results.append(check_video())
    results.append(check_static_asset(login_html))

    print()
    if all(results):
        print("SMOKE TEST PASSED — all routes healthy")
        return 0
    print("SMOKE TEST FAILED — deployment may be broken, investigate before announcing")
    return 1


if __name__ == "__main__":
    sys.exit(main())
