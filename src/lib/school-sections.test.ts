import { strict as assert } from "node:assert";
import {
  normalizeDueNext,
  pickSectionSources,
  type SyncRow,
} from "./school-sections.ts";

function row(over: Partial<SyncRow> & { synced_at: string }): SyncRow {
  return {
    grades: [{ class: "Geometry", grade: 69.5 }],
    class_details: [],
    gpa: null,
    due_next: [],
    attendance: null,
    synergy_mail: [],
    office365_emails: [],
    ...over,
  };
}

// --- Newest grades-only row + older full row: sections come from the full row.
{
  const laptop = row({ synced_at: "2026-10-13T14:15:00Z", due_next: [], synergy_mail: [] });
  const parent = row({
    synced_at: "2026-10-13T13:23:00Z",
    due_next: [{ assignment: "No Red Ink", due: "10/16/2026", class: "Lit" }],
    synergy_mail: [{ subject: "Quiz Friday", date: "2026-10-12" }],
  });
  const { latest, dueSource, mailSource } = pickSectionSources([laptop, parent]);
  assert.equal(latest.synced_at, "2026-10-13T14:15:00Z", "grades from newest row");
  assert.equal(dueSource.synced_at, "2026-10-13T13:23:00Z", "due_next from newest row that has it");
  assert.equal(mailSource.synced_at, "2026-10-13T13:23:00Z", "mail from newest row that has it");
}

// --- All rows empty: falls back to the newest row (honest empty states).
{
  const a = row({ synced_at: "2026-10-13T14:15:00Z" });
  const b = row({ synced_at: "2026-10-13T13:23:00Z" });
  const { latest, dueSource, mailSource } = pickSectionSources([a, b]);
  assert.equal(dueSource, latest);
  assert.equal(mailSource, latest);
}

// --- Newest row has everything: everything from the newest row.
{
  const full = row({
    synced_at: "2026-10-13T14:15:00Z",
    due_next: [{ assignment: "HW", due: "10/14/2026", class: "Gov" }],
    office365_emails: [{ subject: "Hi", date: "2026-10-13" }],
  });
  const old = row({ synced_at: "2026-10-13T13:23:00Z", due_next: [{ assignment: "old" }] });
  const { latest, dueSource, mailSource } = pickSectionSources([full, old]);
  assert.equal(dueSource, latest);
  assert.equal(mailSource, latest);
}

// --- due and mail can come from different rows.
{
  const newest = row({ synced_at: "2026-10-13T15:00:00Z" });
  const withDue = row({ synced_at: "2026-10-13T14:00:00Z", due_next: [{ assignment: "x" }] });
  const withMail = row({ synced_at: "2026-10-13T13:00:00Z", synergy_mail: [{ subject: "y" }] });
  const { dueSource, mailSource } = pickSectionSources([newest, withDue, withMail]);
  assert.equal(dueSource.synced_at, "2026-10-13T14:00:00Z");
  assert.equal(mailSource.synced_at, "2026-10-13T13:00:00Z");
}

console.log("school-sections pickSectionSources: all passed");

// --- normalizeDueNext: laptop-worker shape (assignment key) ---
{
  const out = normalizeDueNext([
    { assignment: "No Red Ink", due: "10/16/2026", class: "Lit" },
    { assignment: "  ", due: "10/17/2026", class: "Gov" },
  ]);
  assert.equal(out.length, 1, "blank assignment dropped");
  assert.equal(out[0].assignment, "No Red Ink");
  assert.equal(out[0].due, "10/16/2026");
  assert.equal(out[0].class, "Lit");
}

// --- normalizeDueNext: ParentVUE fallback shape (title key, extra keys) ---
// Regression: the parent pull keys entries `title`; the old mapper only
// read `assignment` and silently blanked "This week".
{
  const out = normalizeDueNext([
    {
      class: "Lit",
      title: "Practice assessments",
      due: "10/13/2026",
      score: null,
      max_points: 20,
      category: "Practice",
    },
    { class: "Gov", title: "Voter registration HW", due: "10/14/2026" },
    { class: "Gov", title: "", due: "10/15/2026" },
  ]);
  assert.equal(out.length, 2, "title-keyed parent entries must survive");
  assert.equal(out[0].assignment, "Practice assessments");
  assert.equal(out[0].class, "Lit");
  assert.equal(out[1].assignment, "Voter registration HW");
}

// --- normalizeDueNext: assignment wins over title when both present ---
{
  const out = normalizeDueNext([
    { assignment: "A", title: "B", due: "10/16/2026", class: "Lit" },
  ]);
  assert.equal(out[0].assignment, "A");
}

// --- normalizeDueNext: non-array / missing due ---
assert.deepEqual(normalizeDueNext(null), []);
assert.deepEqual(normalizeDueNext("x"), []);
{
  const out = normalizeDueNext([{ title: "No due date" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].due, null);
  assert.equal(out[0].class, null);
}

console.log("school-sections normalizeDueNext: all passed");
