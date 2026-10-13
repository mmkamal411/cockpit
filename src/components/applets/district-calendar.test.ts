import {
  eventsOnDay,
  schoolYearLabel,
  styleForCategory,
  type DistrictCalEvent,
} from "./district-calendar";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok: ${name}`);
  }
}

const events: DistrictCalEvent[] = [
  { title: "Elementary/Middle School Conference Week", event_date: "2026-10-13", end_date: "2026-10-16", category: "Elementary/Middle School Conference Week" },
  { title: "CCSD Board Meeting", event_date: "2026-10-15", end_date: null, category: "Board Meeting" },
  { title: "Thanksgiving Holidays", event_date: "2026-11-23", end_date: "2026-11-27", category: "Holiday - School Closed" },
  { title: "Mystery Event", event_date: "2026-12-05", end_date: null, category: "Some Newfangled Thing" },
];

// Multi-day range: start, middle, end, and outside.
check("conf week on start day", eventsOnDay(events, "2026-10-13").length === 1);
check("conf week mid-range", eventsOnDay(events, "2026-10-14").length === 1);
check("conf week end day", eventsOnDay(events, "2026-10-16").length === 1);
check("conf week after range", eventsOnDay(events, "2026-10-17").length === 0);
// Two events on Oct 15 (conf week + board meeting).
check("two events Oct 15", eventsOnDay(events, "2026-10-15").length === 2);
// Thanksgiving spans month boundary Nov 23–27.
check("thanksgiving Nov 25", eventsOnDay(events, "2026-11-25")[0]?.title === "Thanksgiving Holidays");
check("thanksgiving not Nov 22", eventsOnDay(events, "2026-11-22").length === 0);
// Single-day event with null end_date.
check("single-day match", eventsOnDay(events, "2026-12-05").length === 1);

// Category → dot/label mapping (matches the district legend).
check("conf week purple", styleForCategory("Elementary/Middle School Conference Week", "").dot === "#9333ea");
check("conf week label", styleForCategory("Elementary/Middle School Conference Week", "").label === "Conference Week");
check("holiday red", styleForCategory("Holiday - School Closed", "").dot === "#e11d48");
check("digital orange", styleForCategory("Digital Learning Day", "").dot === "#d97706");
check("board gray", styleForCategory("Board Meeting", "").dot === "#94a3b8");
check("first/last green", styleForCategory("First and Last Days of School", "").dot === "#059669");
check("student blue", styleForCategory("Student Holiday/Staff Day", "").dot === "#2563eb");
check("early release", styleForCategory("Early Release Day - All levels", "").dot === "#ea580c");
// Title keyword fallback when category is null.
check("title fallback -> student holiday (blue)", styleForCategory(null, "Winter Holiday Break").dot === "#2563eb");
check("title fallback -> holidays (closed, red)", styleForCategory(null, "Thanksgiving Holidays").dot === "#e11d48");
check("unknown neutral", styleForCategory(null, "Mystery Event").dot === "#71717a");

// School-year label (July starts the school year).
check("oct 2026 -> 2026–27", schoolYearLabel(2026, 9) === "2026–27");
check("jan 2027 -> 2026–27", schoolYearLabel(2027, 0) === "2026–27");
check("jul 2027 -> 2027–28", schoolYearLabel(2027, 6) === "2027–28");
check("jun 2027 -> 2026–27", schoolYearLabel(2027, 5) === "2026–27");

if (failures > 0) {
  console.error(`${failures} failures`);
  process.exit(1);
}
console.log("district-calendar logic: all green");
