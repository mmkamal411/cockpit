import { strict as assert } from "node:assert";
import { parseBellSchedulePage } from "./school-source-parsers.ts";

function tableHtml(rows: string[]): string {
  const header = `<tr><th>Period</th><th>Start Time</th><th>End Time</th></tr>`;
  return `<html><body><h1>Daily Bell Schedule</h1><table>${header}${rows.join("")}</table></body></html>`;
}

function row(name: string, start: string, end: string): string {
  return `<tr><td>${name}</td><td>${start}</td><td>${end}</td></tr>`;
}

// --- sanity: a clean table still parses with names and times intact ---
{
  const result = parseBellSchedulePage(
    tableHtml([
      row("1st Period", "8:20 AM", "9:13 AM"),
      row("2nd Period", "9:20 AM", "10:13 AM"),
      row("Lunch", "12:00 PM", "12:30 PM"),
    ]),
    "https://school.example/bell",
  );
  assert.equal(result.ok, true, "clean table should parse");
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].label, "Daily");
  assert.deepEqual(
    result.data[0].periods.map((p) => p.name),
    ["1st Period", "2nd Period", "Lunch"],
  );
  assert.equal(result.data[0].periods[0].start, "08:20");
  assert.equal(result.data[0].periods[2].end, "12:30");
  assert.ok(!result.warnings.some((w) => w.includes("left them out")), "no garbage warning for a clean page");
}

// --- boilerplate: the founder's exact report ---
{
  const boilerplate =
    "MASTER SCHEDULE takes place on Monday, Tuesday, and Wednesday each week. " +
    "Please see below. - 1ST PERIOD HR";
  const result = parseBellSchedulePage(
    tableHtml([
      row(boilerplate, "8:20 AM", "9:13 AM"),
      row("2nd Period", "9:20 AM", "10:13 AM"),
      row("3rd Period", "10:20 AM", "11:13 AM"),
      row("4th Period", "11:20 AM", "12:13 PM"),
      row("Lunch", "12:20 PM", "12:50 PM"),
    ]),
    "https://school.example/bell",
  );
  assert.equal(result.ok, true);
  assert.equal(result.data[0].periods[0].name, "1ST PERIOD HR", "boilerplate stripped to the real label");
  assert.ok(
    !result.data[0].periods.some((p) => p.name.toLowerCase().includes("takes place")),
    "boilerplate must never appear as a period name",
  );
}

// --- en-dash separator variant ---
{
  const result = parseBellSchedulePage(
    tableHtml([
      row("MASTER SCHEDULE \u2013 1ST PERIOD HR", "8:20 AM", "9:13 AM"),
      row("2nd Period", "9:20 AM", "10:13 AM"),
      row("3rd Period", "10:20 AM", "11:13 AM"),
    ]),
    "https://school.example/bell",
  );
  assert.equal(result.data[0].periods[0].name, "1ST PERIOD HR");
}

// --- invalid time: end <= start is dropped and counted, never shown ---
{
  const result = parseBellSchedulePage(
    tableHtml([
      row("1st Period", "8:20 AM", "9:13 AM"),
      row("Broken Period", "11:07 AM", "11:04 AM"),
      row("2nd Period", "9:20 AM", "10:13 AM"),
      row("3rd Period", "10:20 AM", "11:13 AM"),
    ]),
    "https://school.example/bell",
  );
  assert.equal(result.ok, true);
  const names = result.data[0].periods.map((p) => p.name);
  assert.ok(!names.includes("Broken Period"), "end<=start row must be dropped");
  assert.equal(names.length, 3);
  assert.ok(
    result.warnings.some((w) => w.includes("skipped 1 table row(s)")),
    "dropped row is counted in a warning",
  );
}

// --- label still >80 chars after stripping: dropped ---
{
  const longName = "A".repeat(90);
  const result = parseBellSchedulePage(
    tableHtml([
      row("1st Period", "8:20 AM", "9:13 AM"),
      row(longName, "9:20 AM", "10:13 AM"),
      row("3rd Period", "10:20 AM", "11:13 AM"),
    ]),
    "https://school.example/bell",
  );
  assert.equal(result.ok, true);
  assert.equal(result.data[0].periods.length, 2, ">80-char label dropped");
  assert.ok(!result.data[0].periods.some((p) => p.name === longName));
}

// --- >30% of rows dropped or boilerplate-heavy: penalty + plain-English warning ---
{
  const result = parseBellSchedulePage(
    tableHtml([
      row("1st Period", "8:20 AM", "9:13 AM"),
      row("Broken A", "11:07 AM", "11:04 AM"),
      row("2nd Period", "9:20 AM", "10:13 AM"),
      row("Broken B", "1:07 PM", "1:04 PM"),
    ]),
    "https://school.example/bell",
  );
  assert.equal(result.ok, true);
  assert.ok(
    result.warnings.some((w) => w.includes("left them out")),
    `expected the plain-English garbage warning, got: ${JSON.stringify(result.warnings)}`,
  );
  assert.equal(result.confidence, "medium", "confidence penalized one level from high");
}

// --- boilerplate-heavy (stripped but kept) also trips the rule ---
{
  const boilerplate = (n: string) =>
    `MASTER SCHEDULE takes place on Monday, Tuesday, and Wednesday each week. Please see below. - ${n}`;
  const result = parseBellSchedulePage(
    tableHtml([
      row(boilerplate("1ST PERIOD HR"), "8:20 AM", "9:13 AM"),
      row(boilerplate("2ND PERIOD"), "9:20 AM", "10:13 AM"),
      row(boilerplate("3RD PERIOD"), "10:20 AM", "11:13 AM"),
      row("4th Period", "11:20 AM", "12:13 PM"),
    ]),
    "https://school.example/bell",
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.data[0].periods.map((p) => p.name),
    ["1ST PERIOD HR", "2ND PERIOD", "3RD PERIOD", "4th Period"],
  );
  assert.ok(
    result.warnings.some((w) => w.includes("left them out")),
    "boilerplate-heavy page gets the warning",
  );
}

console.log("school-source-parsers bell schedule: all passed");
