"""StudentVUE mobile JSON API client. Stdlib only.

This is the interface the official StudentVUE/ParentVUE mobile apps use
(research: verified live against a Synergy district 2026-09-13; Edupoint
retired the legacy SOAP service in August 2026, so this REST API is the
current one):

    POST https://<district-host>/api/v1/mobile/PXPWebServices/<Method>
    body: {"arguments": {"request": "<JSON-encoded params string>"}}

Login is a token exchange: AttemptLogin carries the credentials in the
HTTP Basic header and returns an opaque Bearer <redacted> for subsequent calls.
Every data response is an envelope with an `error` field — a 200 with a
non-null error is still a failure.

AUTH POLICY (E1 research 2026-10-12): Cobb logs every failed AttemptLogin;
repeated failures risk account lockout. Invalid credentials are NEVER
retried — StudentVueAuthError is raised immediately. Only network/5xx
transport errors retry with backoff.

!!! COBB STATUS: UNVERIFIED !!!
Cobb County authenticates students via Microsoft SSO on the web portal.
Whether studentvue.cobbk12.org accepts native username/password on this
mobile API is UNKNOWN until tested from the Windows laptop (which passes
Cobb Conditional Access). The laptop worker uses method="auto": try this
API first, fall back to the Playwright browser sweep on any failure, and
log which path won. Do NOT remove the browser fallback until the API
path has succeeded on the laptop for a full week.

Candidate method names beyond the verified three (Gradebook,
GetChildListData, AttemptLogin) are marked CANDIDATE — the laptop run
should probe them and record which exist.
"""
import base64
import json
import logging

from telemetry.http import HttpError, post_json

log = logging.getLogger("telemetry.studentvue_api")

COBB_UNVERIFIED = True  # set False only after a week of green laptop runs

# P0 fix (2026-10-13, data audit): Synergy PXP's canonical method names use
# the Get*Data pattern. Each entry lists the canonical name FIRST, then
# legacy aliases. Probing stops at the first method that succeeds, and the
# winning name is recorded in the pull result (sections.<name>.method) so
# the next audit can confirm which names Cobb actually serves.
_METHOD_CANDIDATES = {
    "student_info": ("GetStudentInfoData", "StudentInfo"),
    "messages": ("GetPXPContentMessage", "GetPXPMessages", "GetMessages",
                 "Messages"),
    "attendance": ("GetStudentAttendanceList", "GetAttendance", "Attendance"),
    "calendar": ("GetCalendarData", "StudentCalendar"),
    "class_list": ("GetClassList", "StudentClassList"),
}

# !!! SSO CONSTRAINT !!!
# This mobile API client uses NATIVE username/password via HTTP Basic auth.
# It DOES NOT and CANNOT work with Microsoft SSO credentials (student school
# email + password). Cobb students authenticate via Office 365 SSO, which
# requires an interactive browser flow. DO NOT attempt to use this client
# with SSO credentials — it will fail. Student sources (StudentVUE, CTLS
# Learn, school email/calendar) REQUIRE browser automation on a trusted
# device (laptop workers). See the resilience plan Phase 2 for details.


class StudentVueAPIError(RuntimeError):
    pass


class StudentVueAuthError(StudentVueAPIError):
    """Credentials rejected. NEVER retry these — Cobb logs every failed
    AttemptLogin and repeated failures risk account lockout (E1 research
    2026-10-12). Fall back to another transport instead."""


class StudentVueAPI:
    """Thin client for the StudentVUE mobile JSON API."""

    def __init__(self, host, username, password, *, timeout=30,
                 max_attempts=4, logger=None):
        self.host = host  # e.g. "studentvue.cobbk12.org" (no scheme)
        self.username = username
        self.password = password
        self.timeout = timeout
        self.max_attempts = max_attempts
        self._log = logger or log
        self._token = None

    # ---------------------------------------------------------- protocol ---
    def _base(self):
        return f"https://{self.host}/api/v1/mobile/PXPWebServices"

    def _basic_auth(self):
        creds = f"{self.username}:{self.password}".encode("utf-8")
        return "Basic " + base64.b64encode(creds).decode("ascii")

    def login(self):
        """AttemptLogin -> Bearer <redacted>

        Raises StudentVueAuthError when the credentials are rejected
        (NEVER retry — lockout risk); StudentVueAPIError otherwise.
        Network/5xx errors retry with backoff inside post_json.
        """
        url = f"{self._base()}/AttemptLogin"
        body = {"arguments": {"request": json.dumps({"userID": None})}}
        try:
            _status, parsed = post_json(
                url, body,
                headers={"Authorization": self._basic_auth()},
                timeout=self.timeout, max_attempts=self.max_attempts,
                logger=self._log)
        except HttpError as e:
            if e.status == 401:
                raise StudentVueAuthError(
                    f"AttemptLogin rejected credentials (HTTP 401): "
                    f"{e.body[:200]}") from e
            raise StudentVueAPIError(f"AttemptLogin transport failed: {e}") from e
        if isinstance(parsed, dict) and parsed.get("error"):
            err = parsed["error"]
            err_str = str(err)
            # Distinguish real auth failures from server errors.
            # A 500/SQL error means Cobb's backend is broken, NOT that the
            # credentials are wrong. Treating it as auth blocks the SOAP
            # fallback and misleads the user. Only 401/invalid/unauthorized
            # are true auth failures.
            err_lower = err_str.lower()
            is_auth = any(h in err_lower for h in (
                "401", "invalid user", "invalid password", "login failed",
                "unauthorized", "bad credentials", "authentication failed"))
            if is_auth:
                raise StudentVueAuthError(
                    f"AttemptLogin rejected credentials: {err_str[:200]}")
            # Server-side error (500, SQL, etc.) — allow fallback to SOAP.
            raise StudentVueAPIError(
                f"AttemptLogin server error (not auth): {err_str[:200]}")
        token = self._extract_token(parsed)
        if not token:
            raise StudentVueAPIError(
                f"AttemptLogin did not return a token: {str(parsed)[:200]}")
        self._token = token
        self._log.info("StudentVUE API login ok (token acquired)")
        return token

    @staticmethod
    def _extract_token(parsed):
        if not isinstance(parsed, dict):
            return None
        for key in ("token", "Token", "accessToken", "access_token",
                    "authToken", "sessionToken"):
            if parsed.get(key):
                return parsed[key]
        # Some districts nest it under d/ or result/
        for key in ("d", "result", "Result"):
            nested = parsed.get(key)
            if isinstance(nested, dict):
                t = StudentVueAPI._extract_token(nested)
                if t:
                    return t
        return None

    def call(self, method, params=None, _retried=False):
        """POST one API method. Returns the parsed envelope (dict).

        A 401 on a data call triggers ONE re-login (the credentials were
        already proven good by the initial login, so this is token
        refresh, not credential retry). Auth failures never retry.
        """
        if not self._token:
            self.login()
        url = f"{self._base()}/{method}"
        body = {"arguments": {"request": json.dumps(params or {})}}
        try:
            _status, parsed = post_json(
                url, body,
                headers={"Authorization": f"Bearer {self._token}"},
                timeout=self.timeout, max_attempts=self.max_attempts,
                logger=self._log, expect_status=None)
        except HttpError as e:
            if e.status == 401 and not _retried:
                self._log.info("API 401 — refreshing token once")
                self._token = None
                try:
                    self.login()
                except StudentVueAuthError:
                    raise
                return self.call(method, params, _retried=True)
            raise StudentVueAPIError(f"API {method} failed: {e}") from e
        if isinstance(parsed, dict) and parsed.get("error"):
            raise StudentVueAPIError(
                f"API {method} error: {str(parsed['error'])[:300]}")
        return parsed

    # ------------------------------------------------------------ methods ---
    def child_list(self):
        """GetChildListData (verified). Parent logins list children."""
        return self.call("GetChildListData", {"languageCode": "en"})

    def _call_first(self, section, params):
        """Probe _METHOD_CANDIDATES[section] in order; return (method, payload).

        Stops at the first method that succeeds and logs the winner, so the
        laptop run records which name Cobb actually serves. A method miss
        (unknown method / error envelope) is NOT an auth failure and never
        triggers credential retry — probing only happens after login proved
        the credentials good.
        """
        candidates = _METHOD_CANDIDATES[section]
        for candidate in candidates:
            try:
                payload = self.call(candidate, params)
            except StudentVueAPIError as e:
                self._log.info("%s: method %s unavailable: %s",
                               section, candidate, str(e)[:120])
                continue
            self._log.info("%s: using API method %s", section, candidate)
            return candidate, payload
        raise StudentVueAPIError(
            f"{section}: no working method found "
            f"(tried {', '.join(candidates)})")

    def student_info(self, child_id=0):
        """Student info (canonical: GetStudentInfoData; legacy alias probed)."""
        _method, payload = self._call_first(
            "student_info",
            {"childIntID": child_id, "languageCode": "en"})
        return payload

    def gradebook(self, child_id=0):
        """Gradebook (verified): all reporting periods, per-course marks,
        per-mark assignment rows."""
        return self.call("Gradebook", {"childIntID": child_id,
                                       "languageCode": "en"})

    def messages(self, child_id=0):
        """In-portal messages (canonical: GetPXPContentMessage; aliases probed)."""
        _method, payload = self._call_first(
            "messages", {"childIntID": child_id})
        return payload

    def attendance(self, child_id=0):
        """Attendance (canonical: GetStudentAttendanceList; aliases probed)."""
        _method, payload = self._call_first(
            "attendance", {"childIntID": child_id})
        return payload

    def calendar(self, child_id=0):
        """School calendar (canonical: GetCalendarData; legacy alias probed)."""
        _method, payload = self._call_first(
            "calendar", {"childIntID": child_id})
        return payload

    def class_list(self, child_id=0):
        """Class schedule (canonical: GetClassList; legacy alias probed)."""
        _method, payload = self._call_first(
            "class_list", {"childIntID": child_id})
        return payload

    def call_with_method(self, section, params):
        """Probe candidates for `section`; return (winning_method, payload).

        Same as the section methods above but exposes which method name won,
        so pull_all() can record it for the audit trail.
        """
        return self._call_first(section, params)

    # -------------------------------------------------------- normalize ---
    @staticmethod
    def normalize_gradebook(payload):
        """Convert a Gradebook envelope to the internal sync format.

        Returns {"classes": [...], "reporting_periods": [...]} where each
        class is {"class", "grade", "period", "letter", "categories",
        "assignments"} and each assignment is {"title", "category",
        "due", "score", "max_points", "percent", "status", "notes"}.
        Unknown shapes degrade to {"classes": [], ...} — never raises.
        """
        out = {"classes": [], "reporting_periods": []}
        try:
            gb = payload.get("Gradebook") or payload.get("gradebook") or payload
            if isinstance(gb, dict) and "error" in gb and len(gb) == 1:
                return out
            periods = gb.get("reportingPeriods") or gb.get("ReportingPeriods") or []
            for p in periods:
                if isinstance(p, dict):
                    out["reporting_periods"].append({
                        "name": p.get("name") or p.get("periodName", ""),
                        "start": p.get("startDate", ""),
                        "end": p.get("endDate", ""),
                    })
            courses = gb.get("courses") or gb.get("Courses") or []
            for c in courses:
                if not isinstance(c, dict):
                    continue
                title = c.get("title") or c.get("courseTitle") or ""
                for mark in c.get("marks") or c.get("Marks") or [{}]:
                    if not isinstance(mark, dict):
                        continue
                    score = mark.get("score")
                    try:
                        score = float(score) if score is not None else None
                    except (TypeError, ValueError):
                        score = None
                    assignments = []
                    for a in mark.get("assignments") or mark.get("Assignments") or []:
                        if not isinstance(a, dict):
                            continue
                        assignments.append({
                            "title": a.get("title", ""),
                            "category": a.get("category", ""),
                            "due": a.get("dueDate", ""),
                            "score": a.get("score"),
                            "max_points": a.get("pointsPossible"),
                            "percent": _pct(a.get("score"), a.get("pointsPossible")),
                            "status": a.get("status", ""),
                            "notes": a.get("notes", ""),
                        })
                    out["classes"].append({
                        "class": title,
                        "grade": score,
                        "period": mark.get("periodName") or mark.get("name", ""),
                        "letter": mark.get("letter") or mark.get("mark", ""),
                        "categories": _extract_weights(mark),
                        "assignments": assignments,
                        "assignment_count": len(assignments),
                    })
        except Exception as e:
            log.warning("normalize_gradebook degraded: %s", e)
        return out


def _pct(score, max_points):
    try:
        s, m = float(score), float(max_points)
        return round(s / m * 100, 1) if m else None
    except (TypeError, ValueError):
        return None


def _extract_weights(mark):
    """Best-effort category-weight extraction from a mark's raw fields."""
    weights = {}
    for key in ("categoryWeights", "CategoryWeights", "weights",
                "gradeBookWeights", "GradebookWeights"):
        val = mark.get(key)
        if isinstance(val, dict):
            for k, v in val.items():
                try:
                    weights[str(k)] = float(v)
                except (TypeError, ValueError):
                    pass
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, dict):
                    name = item.get("name") or item.get("category")
                    w = item.get("weight")
                    try:
                        if name is not None:
                            weights[str(name)] = float(w)
                    except (TypeError, ValueError):
                        pass
    return weights
