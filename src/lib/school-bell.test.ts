import { strict as assert } from "node:assert";
import { bellTabLabel, formatBellTime } from "./school-bell.ts";

// --- formatBellTime: 24h parser output -> 12h display ---
assert.equal(formatBellTime("07:10"), "7:10");
assert.equal(formatBellTime("7:10"), "7:10");
assert.equal(formatBellTime("08:20"), "8:20");
assert.equal(formatBellTime("12:37"), "12:37", "noon stays 12");
assert.equal(formatBellTime("13:30"), "1:30");
assert.equal(formatBellTime("14:37"), "2:37");
assert.equal(formatBellTime("8:20 AM"), "8:20");
assert.equal(formatBellTime("1:30 PM"), "1:30");
assert.equal(formatBellTime("12:00 AM"), "12:00", "midnight is 12");
// Non-times pass through untouched (rendered as-is, never blanked).
assert.equal(formatBellTime("TBD"), "TBD");
assert.equal(formatBellTime(""), "");
assert.equal(formatBellTime(" 7:10 "), "7:10", "trims whitespace");

// --- bellTabLabel: intake labels -> design-target pills ---
assert.equal(bellTabLabel("Daily 9-period", 0), "Daily");
assert.equal(bellTabLabel("daily", 0), "Daily");
assert.equal(bellTabLabel("WEB 14-row", 1), "WEB Days");
assert.equal(bellTabLabel("WEB Days", 1), "WEB Days");
assert.equal(bellTabLabel("Holiday schedule", 2), "Holiday schedule", "unknown labels kept");
assert.equal(bellTabLabel("", 2), "Schedule 3", "blank label falls back");
assert.equal(bellTabLabel(undefined, 0), "Schedule 1");

console.log("school-bell: all passed");
