"""ParentVUE parent-side pull — Squad Telemetry E1.

Transport ranking (research 2026-10-12, verified live from the sandbox):
  1. REST JSON API  POST https://parentvue.cobbk12.org/api/v1/mobile/PXPWebServices/<Method>
     (AttemptLogin with Basic auth -> Bearer <redacted> JSON envelopes; the sibling
     telemetry/studentvue_api.py client is reused verbatim.)
  2. SOAP API       POST https://parentvue.cobbk12.org/Service/PXPCommunication.asmx
     (ProcessWebServiceRequest; verified live 2026-10-12 — Cobb still serves it.)
  3. Web scrape     PXP2_*.aspx pages (existing parentvue-daily-check browser cron;
     last resort — kept out of this module).

Auth-failure policy: NEVER retry invalid credentials (Cobb's backend logs
every failed AttemptLogin and repeated failures risk account lockout).
Network/transport errors retry with backoff via telemetry.http.

Parent mode: after AttemptLogin, GetChildListData resolves the child
(Dawson); all data calls pass that child's id. With a single linked
child the API also accepts childIntID=0.
"""
import logging
import re
import xml.etree.ElementTree as ET

from telemetry.http import HttpError, request_with_retry
from telemetry.studentvue_api import StudentVueAPI, StudentVueAPIError

log = logging.getLogger("telemetry.parentvue_pull")

PARENT_HOST = "parentvue.cobbk12.org"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0 Safari/537.36"
)
# NOTE: the "StudentVUE/8.0.26" UA gets its POSTs silently dropped by
# Cobb's edge (verified 2026-10-12). Always use a browser UA.
SOAP_URL = f"https://{PARENT_HOST}/Service/PXPCommunication.asmx"

AUTH_FAILURE_HINTS = (
    "invalid user", "invalid password", "login failed",
    "unauthorized", "401",
)


class ParentVuePullError(RuntimeError):
    pass


def _is_auth_failure(message):
    lowered = str(message or "").lower()
    return any(h in lowered for h in AUTH_FAILURE_HINTS)


def _soap_envelope(username, password, method, params):
    inner = "".join(
        f"&lt;{k}&gt;{v}&lt;/{k}&gt;" for k, v in params.items())
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xmlns:xsd="http://www.w3.org/2001/XMLSchema" '
        'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
        '<soap:Body><ProcessWebServiceRequest '
        'xmlns="http://edupoint.com/webservices/">'
        f"<userID>{username}</userID>"
        f"<password>{password}</password>"
        "<skipLoginLog>1</skipLoginLog><parent>1</parent>"
        "<webServiceHandleName>PXPWebServices</webServiceHandleName>"
        f"<methodName>{method}</methodName>"
        f"<paramStr>&lt;Parms&gt;{inner}&lt;/Parms&gt;</paramStr>"
        "</ProcessWebServiceRequest></soap:Body></soap:Envelope>"
    )


class _SoapFallback:
    """Minimal stdlib SOAP client (fallback when the REST API regresses)."""

    def __init__(self, username, password, timeout=30, max_attempts=4):
        self.username = username
        self.password = password
        self.timeout = timeout
        self.max_attempts = max_attempts

    def call(self, method, params=None):
        env = _soap_envelope(self.username, self.password, method,
                             params or {"ChildIntID": 0})
        try:
            status, body = request_with_retry(
                "POST", SOAP_URL,
                headers={
                    "Content-Type": "text/xml; charset=utf-8",
                    "SOAPAction":
                        "http://edupoint.com/webservices/ProcessWebServiceRequest",
                    "User-Agent": BROWSER_UA,
                },
                body=env.encode("utf-8"),
                timeout=self.timeout, max_attempts=self.max_attempts,
                logger=log)
        except HttpError as e:
            raise ParentVuePullError(f"SOAP {method} transport failed: {e}") from e
        text = body.decode("utf-8", errors="replace")
        m = re.search(r'ERROR_MESSAGE="([^"]*)"', text)
        if m:
            msg = m.group(1)
            if _is_auth_failure(msg):
                raise ParentVuePullError(f"SOAP auth failed: {msg}")
            raise ParentVuePullError(f"SOAP {method} RT_ERROR: {msg}")
        inner_m = re.search(
            r"<ProcessWebServiceRequestResult>(.*)</ProcessWebServiceRequestResult>",
            text, re.S)
        if not inner_m:
            raise ParentVuePullError(
                f"SOAP {method}: unparseable response (HTTP {status})")
        payload = inner_m.group(1)
        # The result is XML-escaped XML; unescape one level.
        payload = (payload.replace("&lt;", "<").replace("&gt;", ">")
                   .replace("&quot;", '"').replace("&amp;", "&"))
        return payload


def _parse_soap_gradebook(xml_text):
    """Parse a SOAP Gradebook response into the normalized gradebook shape."""
    out = {"classes": [], "reporting_periods": []}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        log.warning("SOAP gradebook XML parse failed: %s", e)
        return out
    for course in root.iter("Course"):
        title = course.get("Title") or course.get("CourseName") or ""
        period = course.get("Period") or ""
        staff = course.get("Staff") or ""
        room = course.get("RoomName") or ""
        for mark in course.iter("Mark"):
            grade_raw = mark.get("CalculatedScoreRaw")
            try:
                grade = float(grade_raw) if grade_raw not in (None, "") else None
            except (TypeError, ValueError):
                grade = None
            assignments = []
            for a in mark.iter("Assignment"):
                score_raw = a.get("Score")
                pts_raw = a.get("Points")
                try:
                    score = float(score_raw) if score_raw not in (None, "") else None
                except (TypeError, ValueError):
                    score = None
                try:
                    pts = float(pts_raw) if pts_raw not in (None, "") else None
                except (TypeError, ValueError):
                    pts = None
                pct = (round(score / pts * 100, 1)
                       if score is not None and pts else None)
                assignments.append({
                    "title": a.get("Measure") or "",
                    "category": a.get("Type") or "",
                    "due": a.get("Date") or "",
                    "score": score,
                    "max_points": pts,
                    "percent": pct,
                    "status": "",
                    "notes": a.get("Notes") or "",
                })
            categories = {}
            for gc in mark.iter("GradeCalculationSummary"):
                name = gc.get("Type") or ""
                w = gc.get("Weight")
                try:
                    if name:
                        categories[name] = float(w)
                except (TypeError, ValueError):
                    pass
            out["classes"].append({
                "class": title,
                "grade": grade,
                "period": period,
                "letter": mark.get("CalculatedScoreString") or "",
                "teacher": staff,
                "room": room,
                "categories": categories,
                "assignments": assignments,
                "assignment_count": len(assignments),
            })
    return out


def _parse_soap_attendance(xml_text):
    """Parse a SOAP Attendance response into a normalized list of absences."""
    out = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        log.warning("SOAP attendance XML parse failed: %s", e)
        return out
    for absence in root.iter("Absence"):
        periods = []
        for p in absence.iter("Period"):
            periods.append({
                "period": p.get("Number") or "",
                "course": p.get("Course") or "",
                "status": p.get("Name") or "",
                "reason": p.get("Reason") or "",
            })
        out.append({
            "date": absence.get("AbsenceDate") or "",
            "reason": absence.get("Reason") or "",
            "periods": periods,
        })
    return out


class ParentVuePull:
    """Parent-mode ParentVUE pull. REST primary, SOAP fallback."""

    def __init__(self, username, password, *, child_name_hint="",
                 timeout=30, max_attempts=4, logger=None,
                 transport="auto"):
        self.username = username
        self.password = password
        self.child_name_hint = child_name_hint
        self.timeout = timeout
        self.max_attempts = max_attempts
        self._log = logger or log
        self.transport = transport  # "auto" | "rest" | "soap"
        self._rest = None
        self._soap = None
        self._child_id = None
        self._child_name = ""

    # ------------------------------------------------------------ login ---
    def _rest_client(self):
        if self._rest is None:
            self._rest = StudentVueAPI(
                PARENT_HOST, self.username, self.password,
                timeout=self.timeout, max_attempts=self.max_attempts,
                logger=self._log)
        return self._rest

    def _soap_client(self):
        if self._soap is None:
            self._soap = _SoapFallback(
                self.username, self.password,
                timeout=self.timeout, max_attempts=self.max_attempts)
        return self._soap

    def login(self):
        """Authenticate and resolve the child. Raises ParentVuePullError."""
        if self.transport in ("auto", "rest"):
            try:
                self._login_rest()
                self.transport = "rest"
                return
            except ParentVuePullError:
                raise
            except Exception as e:
                if _is_auth_failure(e):
                    raise ParentVuePullError(f"ParentVUE auth failed: {e}") from e
                self._log.warning("REST login failed (%s); trying SOAP fallback",
                                  str(e)[:150])
        if self.transport in ("auto", "soap"):
            self._login_soap()
            self.transport = "soap"
            return
        raise ParentVuePullError("no working ParentVUE transport")

    def _login_rest(self):
        api = self._rest_client()
        try:
            api.login()
        except StudentVueAPIError as e:
            if _is_auth_failure(e):
                # Auth failures fail fast: no fallback, no retry
                # (repeated bad logins risk account lockout).
                raise ParentVuePullError(f"ParentVUE auth failed: {e}") from e
            # Server/transport failure: propagate unwrapped so login()
            # falls through to the SOAP fallback.
            raise
        payload = api.child_list()
        children = self._extract_children(payload)
        child = self._pick_child(children)
        self._child_id = child.get("id", 0)
        self._child_name = child.get("name", "")
        self._log.info("ParentVUE REST login ok; child=%r (id=%s)",
                       self._child_name, self._child_id)

    def _login_soap(self):
        api = self._soap_client()
        try:
            xml_text = api.call("Gradebook", {"ChildIntID": 0})
        except ParentVuePullError:
            raise
        # A parseable Gradebook response proves the credentials work.
        probe = _parse_soap_gradebook(xml_text)
        if not probe["classes"] and "RT_ERROR" in xml_text:
            raise ParentVuePullError("ParentVUE SOAP auth failed")
        self._child_id = 0
        self._child_name = self.child_name_hint
        self._log.info("ParentVUE SOAP login ok (childIntID=0)")

    @staticmethod
    def _extract_children(payload):
        """Pull a child list out of a GetChildListData envelope (any shape)."""
        out = []
        try:
            candidates = []
            if isinstance(payload, dict):
                for key in ("children", "Children", "childList", "ChildList"):
                    v = payload.get(key)
                    if isinstance(v, list):
                        candidates = v
                        break
                if not candidates:
                    # search one level deep (envelopes nest under d/result)
                    for v in payload.values():
                        if isinstance(v, dict):
                            for k2 in ("children", "Children"):
                                if isinstance(v.get(k2), list):
                                    candidates = v[k2]
                                    break
            for c in candidates:
                if not isinstance(c, dict):
                    continue
                cid = c.get("childIntID", c.get("childID",
                            c.get("id", c.get("ID", 0))))
                name = c.get("childName") or c.get("name") or " ".join(
                    x for x in (c.get("firstName", ""), c.get("lastName", ""))
                    if x) or ""
                try:
                    cid = int(cid)
                except (TypeError, ValueError):
                    cid = 0
                out.append({"id": cid, "name": str(name).strip(), "raw": c})
        except Exception as e:
            log.warning("child list extraction degraded: %s", e)
        return out

    def _pick_child(self, children):
        if not children:
            self._log.warning("GetChildListData returned no children; "
                              "using childIntID=0")
            return {"id": 0, "name": self.child_name_hint}
        if self.child_name_hint:
            hint = self.child_name_hint.lower()
            for c in children:
                if hint in c["name"].lower():
                    return c
            self._log.warning("child hint %r matched none of %s; using first",
                              self.child_name_hint,
                              [c["name"] for c in children])
        if len(children) == 1:
            return children[0]
        self._log.warning("%d children; using first (%s). Set child_name_hint "
                          "to disambiguate.",
                          len(children), children[0]["name"])
        return children[0]

    # ------------------------------------------------------------- pulls ---
    def _call_rest(self, fn_name, *args, **kwargs):
        # Auth failures -> ParentVuePullError (aborts the whole pull).
        # Anything else -> original error (that section degrades, rest continue).
        try:
            return getattr(self._rest_client(), fn_name)(*args, **kwargs)
        except StudentVueAPIError as e:
            if _is_auth_failure(e):
                raise ParentVuePullError(f"ParentVUE auth failed: {e}") from e
            raise

    def pull_all(self):
        """Run every ParentVUE pull. Returns a normalized result dict.

        Never raises for partial failures: each section records its own
        error and the rest continue (graceful degradation).
        """
        result = {
            "transport": self.transport,
            "child_id": self._child_id,
            "child_name": self._child_name,
            "sections": {},
            "errors": [],
        }

        def _section(name, fn):
            try:
                result["sections"][name] = fn()
                self._log.info("parentvue section ok: %s", name)
            except ParentVuePullError as e:
                # Auth failures are fatal — no point pulling the rest.
                result["errors"].append({"section": name, "error": str(e)})
                raise
            except Exception as e:  # noqa: BLE001 — degrade, don't die
                self._log.warning("parentvue section failed: %s: %s", name, e)
                result["errors"].append({"section": name, "error": str(e)[:300]})
                result["sections"][name] = None

        def _rest_section(name, section, child_id):
            """Pull one REST section via candidate probing; record the winner.

            Returns {"raw": <envelope>, "method": <winning method name>} so
            the audit trail shows which API name Cobb actually served.
            Auth failures stay fatal (same policy as _call_rest): no point
            pulling the rest if the session died mid-pull.
            """
            def _do():
                try:
                    method, payload = self._rest_client().call_with_method(
                        section, {"childIntID": child_id, "languageCode": "en"})
                except StudentVueAPIError as e:
                    if _is_auth_failure(e):
                        raise ParentVuePullError(
                            f"ParentVUE auth failed: {e}") from e
                    raise
                return {"raw": payload, "method": method}
            _section(name, _do)

        def _soap_unavailable(name):
            """Record an explicit skip for REST-only sections in SOAP mode.

            Non-fatal: raises a plain RuntimeError (not ParentVuePullError)
            so _section degrades the one section instead of aborting the pull.
            Visible in result["errors"] — never silent.
            """
            def _do():
                raise RuntimeError(
                    f"{name}: no SOAP equivalent; REST-only section "
                    f"(transport={self.transport})")
            _section(name, _do)

        try:
            cid = self._child_id or 0
            if self.transport == "soap":
                _section("gradebook",
                         lambda: _parse_soap_gradebook(
                             self._soap_client().call(
                                 "Gradebook", {"ChildIntID": cid})))
                _section("attendance",
                         lambda: {"absences": _parse_soap_attendance(
                             self._soap_client().call(
                                 "Attendance", {"ChildIntID": cid})),
                             "method": "Attendance"})
                # No SOAP equivalents exist for these — record explicit
                # skips (visible in errors) instead of silent empty data.
                _soap_unavailable("messages")
                _soap_unavailable("calendar")
                _soap_unavailable("schedule")
                _soap_unavailable("student_info")
            else:
                _section("gradebook",
                         lambda: StudentVueAPI.normalize_gradebook(
                             self._call_rest("gradebook", cid)))
                _rest_section("attendance", "attendance", cid)
                _rest_section("messages", "messages", cid)
                _rest_section("calendar", "calendar", cid)
                _rest_section("schedule", "class_list", cid)
                _rest_section("student_info", "student_info", cid)
        except ParentVuePullError:
            pass
        return result
