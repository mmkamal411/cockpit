/**
 * parseTodo extensions tests — priorities, projects, assignees, recurrence.
 *
 * Run: node src/lib/parse-todo.test.ts   (Node ≥ 22 strips types natively)
 */
import { strict as assert } from "node:assert";
import { parseTodo } from "./parse-todo.ts";

const NOW = new Date(2026, 9, 13, 10, 0, 0).getTime(); // Tue Oct 13 2026 10:00

// --- priorities ---
{
  const p = parseTodo("fix the sink p1", NOW);
  assert.equal(p.priority, "p1");
  assert.equal(p.text, "fix the sink");
}
{
  const p = parseTodo("read book P3 tomorrow", NOW);
  assert.equal(p.priority, "p3");
  assert(p.dueAt !== undefined);
}

// --- #project ---
{
  const p = parseTodo("buy milk #Family", NOW);
  assert.equal(p.project, "Family");
  assert.equal(p.text, "buy milk");
}

// --- +assignee ---
{
  const p = parseTodo("pick up dry cleaning +Dawson", NOW);
  assert.equal(p.assignee, "Dawson");
  assert.equal(p.text, "pick up dry cleaning");
}

// --- recurrence seeds the first due date ---
{
  const p = parseTodo("water the plants every Monday", NOW);
  assert.equal(p.recurrence, "every monday");
  assert(p.dueAt !== undefined);
  const d = new Date(p.dueAt!);
  assert.equal(d.getDay(), 1); // Monday
  assert.equal(d.getHours(), 9);
  assert.equal(p.text, "water the plants");
}
{
  const p = parseTodo("take out trash every friday at 6pm", NOW);
  assert.equal(p.recurrence, "every friday");
  assert.equal(p.hasTime, true);
  const d = new Date(p.dueAt!);
  assert.equal(d.getDay(), 5);
  assert.equal(d.getHours(), 18);
}

// --- hasTime: explicit time vs date-only ---
{
  const timed = parseTodo("call mom tomorrow at 3pm", NOW);
  assert.equal(timed.hasTime, true);
}
{
  const dateOnly = parseTodo("call mom tomorrow", NOW);
  assert.equal(dateOnly.hasTime, false);
}
{
  const none = parseTodo("call mom", NOW);
  assert.equal(none.dueAt, undefined);
  assert.equal(none.text, "call mom");
}

// --- combo: everything at once ---
{
  const p = parseTodo("review budget #Family +Meheldi p2 every month on the 1st", NOW);
  assert.equal(p.priority, "p2");
  assert.equal(p.project, "Family");
  assert.equal(p.assignee, "Meheldi");
  assert.equal(p.recurrence, "every month");
}

console.log("parse-todo.test.ts: all assertions passed");
