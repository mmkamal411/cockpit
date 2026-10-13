import { strict as assert } from "node:assert";
import {
  NOT_A_BELL_MESSAGE,
  pageLooksLikeBell,
  pageLooksLikeCalendar,
} from "./school-sources.ts";

// --- pageLooksLikeBell: real bell schedule page ---
{
  const periods = [
    ["0 Period", "07:10", "08:13"],
    ["1st", "08:20", "09:13"],
    ["HR", "09:20", "09:30"],
    ["2nd", "09:37", "10:30"],
    ["3rd", "10:37", "11:30"],
    ["4th", "11:37", "12:30"],
    ["5th", "12:37", "13:30"],
    ["6th", "13:37", "14:30"],
    ["7th", "14:37", "15:30"],
  ];
  const rows = periods
    .map(([p, s, e]) => `<tr><td>${p}</td><td>${s}</td><td>${e}</td></tr>`)
    .join("");
  const html = `<html><body><h1>Daily Bell Schedule</h1><table>${rows}</table></body></html>`;
  assert.equal(pageLooksLikeBell(html), true, "real bell table should pass");
}

// --- pageLooksLikeBell: district homepage link farm ---
{
  const junkLinks = [
    "Bus Numbers & Routes", "Cobb Digital Library", "Cobb Shield", "CTLS Learn",
    "CTLS Support", "Digital Textbooks", "District Strategic Plan",
    "Employment Opportunities", "Enroll Your Student", "Family Info Guide",
    "GoFan Tickets", "Grades & Attendance", "Lunch Menus", "Lunch MySchoolBucks",
    "My Payments Plus", "Yearbook Information",
    "Cobb Schools Foundation", "Budget & Finance", "Calendar", "Staff Directory",
    "News", "Events", "Board", "Policies", "Careers", "Contact",
  ];
  const links = junkLinks
    .map((t) => `<div class="quicklink"><a href="https://www.cobbk12.org/x">${t}</a></div>`)
    .join("");
  const html = `<html><body><h1>Find it Fast</h1>${links}<p>Welcome to Cobb County School District</p></body></html>`;
  assert.equal(pageLooksLikeBell(html), false, "link farm should fail");
  assert.equal(pageLooksLikeCalendar(html), false, "link farm should fail calendar check too");
}

// --- pageLooksLikeBell: empty / garbage ---
assert.equal(pageLooksLikeBell(""), false);
assert.equal(pageLooksLikeBell("<html><body>hello</body></html>"), false);

// --- NOT_A_BELL_MESSAGE is plain English ---
assert.ok(NOT_A_BELL_MESSAGE.length > 20);
assert.ok(!/chrome|DOM|sanitize/i.test(NOT_A_BELL_MESSAGE), "no jargon");

console.log("school-sources bell checks: all passed");
