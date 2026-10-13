#!/usr/bin/env python3
"""Mock tests for the ParentVUE P0 fix (2026-10-13).

No live credentials needed. Tests:
1. _call_first probing: first candidate fails, second succeeds -> winner recorded.
2. _call_first probing: all candidates fail -> StudentVueAPIError.
3. build_payload: full mock pull result -> payload has all sections wired.
4. build_payload: empty gradebook -> RuntimeError (C1 gate).
5. build_payload: missing sections -> graceful defaults, no crash.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from telemetry.studentvue_api import StudentVueAPI, StudentVueAPIError

# parentvue-laptop-sync has a hyphen; import via importlib
import importlib.util
_spec = importlib.util.spec_from_file_location(
    "pv_sync", str(HERE / "parentvue-laptop-sync.py"))
_pv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pv)

passed = failed = 0

def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS: {name}")
    else:
        failed += 1
        print(f"  FAIL: {name} {extra}")

print("== 1. _call_first probing ==")
api = StudentVueAPI("host", "user", "pass")

def fake_call_ok_second(method, params):
    if method == "GetPXPContentMessage":
        raise StudentVueAPIError("API GetPXPContentMessage error: unknown method")
    if method == "GetPXPMessages":
        return {"Messages": [{"id": 1}]}
    raise AssertionError("should not reach " + method)

with patch.object(StudentVueAPI, "call", side_effect=fake_call_ok_second):
    method, payload = api.call_with_method("messages", {"childIntID": 0})
    check("winner is second candidate", method == "GetPXPMessages", f"got {method}")
    check("payload returned", payload == {"Messages": [{"id": 1}]})

def fake_call_all_fail(method, params):
    raise StudentVueAPIError(f"API {method} error: unknown method")

with patch.object(StudentVueAPI, "call", side_effect=fake_call_all_fail):
    try:
        api.call_with_method("attendance", {"childIntID": 0})
        check("all-fail raises", False)
    except StudentVueAPIError as e:
        check("all-fail raises", "no working method found" in str(e))
        check("all-fail lists candidates", "GetStudentAttendanceList" in str(e))

print("== 2. canonical-first ordering ==")
from telemetry.studentvue_api import _METHOD_CANDIDATES
check("student_info canonical first",
      _METHOD_CANDIDATES["student_info"][0] == "GetStudentInfoData")
check("messages canonical first",
      _METHOD_CANDIDATES["messages"][0] == "GetPXPContentMessage")
check("attendance canonical first",
      _METHOD_CANDIDATES["attendance"][0] == "GetStudentAttendanceList")
check("calendar canonical first",
      _METHOD_CANDIDATES["calendar"][0] == "GetCalendarData")
check("legacy aliases retained",
      "StudentInfo" in _METHOD_CANDIDATES["student_info"]
      and "Messages" in _METHOD_CANDIDATES["messages"])

print("== 3. build_payload with full mock result ==")
mock_result = {
    "transport": "rest",
    "child_id": 0,
    "errors": [],
    "sections": {
        "gradebook": {"classes": [
            {"class": "Geometry", "grade": 69.5, "period": "2",
             "letter": "D", "teacher": "Thomason",
             "categories": {}, "assignments": [
                 {"title": "Quiz 2", "score": 37, "max_points": 100,
                  "due": "2026-10-01", "category": "Quiz"},
                 {"title": "HW 5", "score": None, "max_points": 20,
                  "due": "2026-10-20", "category": "HW"},
             ], "assignment_count": 2},
        ]},
        "attendance": {"raw": {"absences": []}, "method": "GetStudentAttendanceList"},
        "messages": {"raw": {"Messages": [{"subject": "hi"}]},
                     "method": "GetPXPContentMessage"},
        "calendar": {"raw": {"events": [{"title": "Fall break"}]},
                     "method": "GetCalendarData"},
        "schedule": {"raw": {"classes": ["Geometry"]}, "method": "GetClassList"},
        "student_info": {"raw": {"name": "Dawson"}, "method": "GetStudentInfoData"},
    },
}
cfg = {"crew_member_id": "91ea2b85-45c9-4f84-96c1-2829d30e5eb6",
       "device_name": "test", "supabase_url": "x", "supabase_anon_key": "y"}
p = _pv.build_payload(cfg, mock_result)
check("grades wired", p["grades"] == [
    {"class": "Geometry", "grade": 69.5, "period": "2"}],
    json.dumps(p["grades"]))
check("class_details wired", len(p["class_details"]) == 1
      and p["class_details"][0]["teacher"] == "Thomason")
check("due_next has ungraded", len(p["due_next"]) == 1
      and p["due_next"][0]["assignment"] == "HW 5")
check("attendance passed through",
      p["attendance"] == {"raw": {"absences": []}, "method": "GetStudentAttendanceList"})
check("synergy_mail extracted", p["synergy_mail"] == [{"subject": "hi"}],
      json.dumps(p["synergy_mail"])[:120])
check("calendar_events wired",
      p["calendar_events"] == {"method": "GetCalendarData",
                               "events": [{"title": "Fall break"}]},
      json.dumps(p["calendar_events"])[:120])
check("class_schedule wired",
      p["class_schedule"] == {"method": "GetClassList",
                              "raw": {"classes": ["Geometry"]}})
check("student_info wired",
      p["student_info"] == {"method": "GetStudentInfoData",
                            "raw": {"name": "Dawson"}})
check("crew_member_id present",
      p["crew_member_id"] == "91ea2b85-45c9-4f84-96c1-2829d30e5eb6")
check("no plaintext password in payload",
      "pass" not in json.dumps(p).lower().replace("password", ""))

print("== 4. C1 gate: empty gradebook aborts ==")
try:
    _pv.build_payload(cfg, {"transport": "rest", "errors": [],
                            "sections": {"gradebook": {"classes": []}}})
    check("empty gradebook raises", False)
except RuntimeError as e:
    check("empty gradebook raises", "zero classes" in str(e))

print("== 5. missing sections degrade gracefully ==")
p2 = _pv.build_payload(cfg, {"transport": "soap", "errors": [
    {"section": "messages", "error": "no SOAP equivalent"}],
    "sections": {
        "gradebook": {"classes": [
            {"class": "Gov", "grade": 79.0, "period": "1"}]},
        "attendance": {"absences": [], "method": "Attendance"},
        "messages": None,
        "calendar": None,
        "schedule": None,
        "student_info": None,
    }})
check("soap attendance ok", p2["attendance"] == {"absences": [], "method": "Attendance"})
check("missing messages -> []", p2["synergy_mail"] == [])
check("missing calendar -> empty events",
      p2["calendar_events"] == {"method": None, "events": []})
check("missing schedule -> empty raw",
      p2["class_schedule"] == {"method": None, "raw": {}})
check("missing student_info -> empty raw",
      p2["student_info"] == {"method": None, "raw": {}})

print("== 6. envelope extraction helpers ==")
check("nested envelope events",
      _pv._extract_event_list({"d": {"events": [{"t": 1}]}}) == [{"t": 1}])
check("unknown envelope -> []",
      _pv._extract_event_list({"weird": 1}) == [])
check("envelope message list",
      _pv._extract_message_list(
          {"raw": {"Messages": [{"s": 1}]}}) == [{"s": 1}])
check("direct message list",
      _pv._extract_message_list({"messages": [{"s": 2}]}) == [{"s": 2}])
check("unknown message shape preserved",
      _pv._extract_message_list({"zzz": 1}) == {"zzz": 1})

print("== 7. pull_all: auth failure stays fatal, method miss degrades ==")
from telemetry.parentvue_pull import ParentVuePull, ParentVuePullError

pull = ParentVuePull("user", "pass", transport="rest")
pull._child_id = 0
pull._child_name = "Test"

class FakeRest:
    def __init__(self, behavior):
        self.behavior = behavior  # "auth_fail" | "miss_then_ok"
        self.calls = []
    def call_with_method(self, section, params):
        self.calls.append(section)
        if self.behavior == "auth_fail":
            raise StudentVueAPIError("API GetCalendarData failed: 401 Unauthorized")
        # miss_then_ok: gradebook works, others miss all candidates
        if section in ("attendance", "messages", "calendar", "class_list",
                       "student_info"):
            raise StudentVueAPIError(
                f"{section}: no working method found (tried X, Y)")
        raise AssertionError("unexpected section " + section)
    def gradebook(self, child_id):
        return {"Gradebook": {"courses": []}}

# gradebook via _call_rest -> needs _rest_client().gradebook; FakeRest has it.
pull._rest = FakeRest("miss_then_ok")
res = pull.pull_all()
check("gradebook section present", "gradebook" in res["sections"])
check("missed sections are None (degraded, not fatal)",
      all(res["sections"].get(s) is None
          for s in ("attendance", "messages", "calendar", "schedule",
                    "student_info")))
check("misses recorded in errors",
      len([e for e in res["errors"]
           if "no working method found" in e["error"]]) == 5,
      json.dumps(res["errors"])[:200])

pull2 = ParentVuePull("user", "pass", transport="rest")
pull2._child_id = 0
pull2._rest = FakeRest("auth_fail")
# gradebook succeeds (empty classes ok for pull_all), calendar 401s -> fatal
res2 = pull2.pull_all()
check("auth failure aborts remaining sections",
      "calendar" not in res2["sections"] or res2["sections"].get("schedule") is None)
check("auth error recorded",
      any("auth failed" in e["error"].lower() for e in res2["errors"]),
      json.dumps(res2["errors"])[:200])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)