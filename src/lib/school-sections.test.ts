import { strict as assert } from "node:assert";
import { pickSectionSources, type SyncRow } from "./school-sections.ts";

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
