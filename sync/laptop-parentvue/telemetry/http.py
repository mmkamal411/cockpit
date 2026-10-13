"""HTTP helpers with retry + exponential backoff. Stdlib only.

Every network call in the telemetry pipeline goes through
request_with_retry(): transient failures (429/5xx, timeouts, connection
resets) are retried with exponential backoff + jitter. Permanent failures
(4xx other than 429) fail fast.

Usage:
    from telemetry.http import get_json, post_json

    data = get_json("https://example.com/api", headers={...}, timeout=30)
    data = post_json(url, payload_dict, headers={...})
"""
import json
import logging
import random
import time
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("telemetry.http")

RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}
DEFAULT_TIMEOUT = 30


class HttpError(RuntimeError):
    """Non-retryable (or retries-exhausted) HTTP failure."""

    def __init__(self, message, status=None, body=""):
        super().__init__(message)
        self.status = status
        self.body = body[:500]


def _backoff_delay(attempt, base_delay, max_delay):
    """Exponential backoff with full jitter. attempt is 0-based."""
    exp = min(base_delay * (2 ** attempt), max_delay)
    return random.uniform(0, exp)


def request_with_retry(method, url, *, headers=None, body=None,
                       timeout=DEFAULT_TIMEOUT, max_attempts=5,
                       base_delay=1.0, max_delay=60.0,
                       retryable_status=RETRYABLE_STATUS,
                       logger=None):
    """Send one HTTP request with retries. Returns (status, body_bytes).

    Raises HttpError when retries are exhausted or the failure is
    permanent. `body` may be bytes or a str (encoded as UTF-8).
    """
    _log = logger or log
    last_exc = None
    if isinstance(body, str):
        body = body.encode("utf-8")

    for attempt in range(max_attempts):
        try:
            req = urllib.request.Request(
                url, data=body, headers=dict(headers or {}), method=method.upper())
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            if e.code in retryable_status and attempt < max_attempts - 1:
                delay = _backoff_delay(attempt, base_delay, max_delay)
                _log.warning("HTTP %s %s -> %s (attempt %d/%d), retry in %.1fs",
                             method, url, e.code, attempt + 1, max_attempts, delay)
                time.sleep(delay)
                continue
            raise HttpError(f"{method} {url} -> HTTP {e.code}",
                            status=e.code, body=err_body) from e
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last_exc = e
            if attempt < max_attempts - 1:
                delay = _backoff_delay(attempt, base_delay, max_delay)
                _log.warning("%s %s failed (%s, attempt %d/%d), retry in %.1fs",
                             method, url, e, attempt + 1, max_attempts, delay)
                time.sleep(delay)
                continue
            raise HttpError(f"{method} {url} failed after {max_attempts} attempts: {e}") from e

    raise HttpError(f"{method} {url} failed: {last_exc}")


def get_json(url, *, headers=None, timeout=DEFAULT_TIMEOUT,
             max_attempts=5, logger=None, params=None):
    """GET a URL and parse the JSON body. Returns the parsed object."""
    if params:
        qs = urllib.parse.urlencode(params)
        url = f"{url}?{qs}" if "?" not in url else f"{url}&{qs}"
    status, body = request_with_retry(
        "GET", url, headers=headers, timeout=timeout,
        max_attempts=max_attempts, logger=logger)
    if status >= 400:
        raise HttpError(f"GET {url} -> HTTP {status}", status=status)
    try:
        return json.loads(body.decode("utf-8") or "null")
    except json.JSONDecodeError as e:
        raise HttpError(f"GET {url} returned invalid JSON: {e}", status=status) from e


def post_json(url, payload, *, headers=None, timeout=DEFAULT_TIMEOUT,
              max_attempts=5, logger=None, expect_status=(200, 201)):
    """POST a JSON payload. Returns (status, parsed_body_or_None)."""
    body = json.dumps(payload).encode("utf-8")
    hdrs = {"Content-Type": "application/json", "Accept": "application/json"}
    hdrs.update(headers or {})
    status, raw = request_with_retry(
        "POST", url, headers=hdrs, body=body, timeout=timeout,
        max_attempts=max_attempts, logger=logger)
    if expect_status and status not in expect_status:
        raise HttpError(f"POST {url} -> HTTP {status}", status=status,
                        body=raw.decode("utf-8", errors="replace"))
    try:
        parsed = json.loads(raw.decode("utf-8") or "null")
    except json.JSONDecodeError:
        parsed = None
    return status, parsed
