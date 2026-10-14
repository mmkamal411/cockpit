import { strict as assert } from "node:assert";
import {
  diffCategories,
  diffGrades,
  diffKeyed,
  diffTitled,
  emptyKind,
  friendlyPipeline,
  freshnessLine,
  hoursSince,
  sanitizeSyncSnapshot,
} from "./sync-review.ts";

// --- sanitize: laptop shape (assignments arrays, {} categories) ---
{
  const snap = sanitizeSyncSnapshot({
    synced_at: "2026-10-13T18:00:00Z",
    pull_method: "browser",
    device_name: "macbook",
    grades: [{ class: "Geometry", grade: 69.5 }],
    class_details: [
      {
        class: "Geometry",
        teacher: "Kathryn Thomason",
        categories: {},
        assignments: [
          { title: "Quiz 2", due: "10/10/2026", score: 37, category: "Quiz" },
          { title: "HW 5", due: "10/20/2026", score: null, category: "Homework" },
          { title: "Old quiz", due: "10/01/2026", score: null, status: "Missing" },
        ],
      },
    ],
    due_next: [{ assignment: "No Red Ink", due: "10/16/2026", class: "Lit" }],
    gpa: {},
  });
  assert.equal(snap.grades.length, 1, "one grade");
  assert.equal(snap.grades[0].letter, "F", "69.5 is an F on the Cobb scale");
  assert.equal(snap.grades[0].gapTo90, 20.5, "gap to 90");
  assert.equal(snap.grades[0].teacher, "Kathryn Thomason", "teacher lookup");
  assert.equal(snap.categories.length, 0, "empty categories object yields none");
  assert.equal(snap.missing.length, 1, "missing flagged by status");
  assert.equal(snap.upcomingAssignments.length, 1, "future unscored -> upcoming");
  assert.equal(snap.graded.length, 1, "scored -> graded");
  assert.equal(snap.dueNext[0].assignment, "No Red Ink", "due_next title");
  assert.deepEqual(snap.gpa, {}, "empty gpa object");
  assert.equal(friendlyPipeline(snap.pullMethod, snap.deviceName), "MacBook", "pipeline label");
}

// --- sanitize: parent shape (recent_items strings, missing count) ---
{
  const snap = sanitizeSyncSnapshot({
    synced_at: "2026-10-13T13:23:00Z",
    pull_method: "api",
    device_name: "parent-sync",
    grades: [{ class: "Geometry", grade: "71.0" }],
    class_details: [
      {
        class: "Geometry",
        missing: 2,
        recent_items: ["Quiz 3.1 (Week 09): 30.00% (10/01)", "Chapter review"],
      },
    ],
  });
  assert.equal(snap.missingCountFallback, 2, "parent missing count summed");
  assert.equal(snap.graded.length, 2, "recent_items become graded entries");
  assert.equal(snap.graded[0].title, "Quiz 3.1 (Week 09)", "recent_item title parsed");
  assert.equal(snap.graded[0].score, "30.00%", "recent_item score parsed");
  assert.equal(snap.graded[0].due, "10/01", "recent_item date parsed");
  assert.equal(snap.grades[0].grade, 71, "string grade coerced");
  assert.equal(friendlyPipeline(snap.pullMethod, snap.deviceName), "ParentVUE pull (this station)");
}

// --- diffGrades: changed / new / removed ---
{
  const prev = sanitizeSyncSnapshot({
    grades: [
      { class: "Geometry", grade: 69.5 },
      { class: "Art", grade: 95 },
    ],
  }).grades;
  const cur = sanitizeSyncSnapshot({
    grades: [
      { class: "Geometry", grade: 71 },
      { class: "Music", grade: 88 },
    ],
  }).grades;
  const d = diffGrades(cur, prev);
  const byName = new Map(d.map((x) => [x.name, x]));
  assert.equal(byName.get("Geometry")?.kind, "changed", "grade change detected");
  assert.equal(byName.get("Geometry")?.from, 69.5, "from value");
  assert.equal(byName.get("Geometry")?.to, 71, "to value");
  assert.equal(byName.get("Music")?.kind, "new", "new class detected");
  assert.equal(byName.get("Art")?.kind, "removed", "removed class detected");
}

// --- diffKeyed: gpa / attendance ---
{
  const d = diffKeyed({ weighted: "3.2", hope: "3.0" }, { weighted: "3.1", hope: "3.0" });
  assert.equal(d.length, 1, "only the changed key");
  assert.equal(d[0].key, "weighted", "key name");
  assert.equal(d[0].from, "3.1", "old value");
  assert.equal(d[0].to, "3.2", "new value");
}

// --- diffTitled: announcements ---
{
  const d = diffTitled([{ title: "Spirit week" }, { title: "PSAT" }], [{ title: "PSAT" }]);
  assert.equal(d.length, 1, "one new announcement");
  assert.equal(d[0].title, "Spirit week");
  assert.equal(d[0].kind, "new");
}

// --- diffCategories: weight change ---
{
  const prev = sanitizeSyncSnapshot({
    class_details: [{ class: "Geometry", categories: { Tests: { weight: 40, average: 55 } } }],
  }).categories;
  const cur = sanitizeSyncSnapshot({
    class_details: [{ class: "Geometry", categories: { Tests: { weight: 40, average: 60 } } }],
  }).categories;
  const d = diffCategories(cur, prev);
  assert.equal(d.length, 1, "one category change");
  assert.equal(d[0].field, "average", "average moved");
  assert.equal(d[0].from, 55);
  assert.equal(d[0].to, 60);
}

// --- emptyKind: the honesty matrix ---
{
  assert.equal(emptyKind("gpa", false, false), "not-collected", "gpa never collected");
  assert.equal(emptyKind("gpa", false, true), "not-collected", "gpa never collected even if row once had it");
  assert.equal(emptyKind("announcements", false, true), "failed-this-pull", "had before, empty now");
  assert.equal(emptyKind("announcements", false, false), "no-new-data", "never had");
  assert.equal(emptyKind("grades", true, false), null, "present -> no reason needed");
  assert.equal(emptyKind("outlook", false, false), "not-collected", "outlook integration not built");
}

// --- freshness wording ---
{
  assert.equal(freshnessLine(null), "Last pull time unknown");
  assert.equal(freshnessLine(0), "Last pulled just now");
  assert.equal(freshnessLine(1), "Last pulled 1 hour ago");
  assert.equal(freshnessLine(5), "Last pulled 5 hours ago");
  assert.equal(freshnessLine(30), "Last pulled 1 day ago");
  assert.equal(freshnessLine(50), "Last pulled 2 days ago");
  assert.equal(typeof hoursSince("2026-10-13T18:00:00Z"), "number", "parses real timestamps");
  assert.equal(hoursSince(null), null, "null in, null out");
  assert.equal(hoursSince("not-a-date"), null, "garbage in, null out");
}

// --- mail sanitize: both sources keep their identity ---
{
  const snap = sanitizeSyncSnapshot({
    synergy_mail: [{ subject: "Quiz Friday", date: "2026-10-12", preview: "Study guide" }],
    office365_emails: [],
  });
  assert.equal(snap.synergyMail.length, 1, "synergy message kept");
  assert.equal(snap.synergyMail[0].source, "synergy", "source tagged");
  assert.equal(snap.outlookMail.length, 0, "outlook empty");
}

// --- zero guard flags + syllabi ---
{
  const snap = sanitizeSyncSnapshot({
    zero_guard_flags: ["grade dropped to 0 in Geometry"],
    ctls_syllabi: { Geometry: { url: "https://x", text: "..." } },
    past_periods: [{ period: "Q1", value: "82" }],
  });
  assert.equal(snap.zeroGuardFlags.length, 1, "flag kept");
  assert.equal(snap.syllabi[0].className, "Geometry", "syllabus keyed by class");
  assert.equal(snap.pastPeriods[0].period, "Q1", "past period kept");
}

console.log("sync-review.test.ts: all assertions passed");
