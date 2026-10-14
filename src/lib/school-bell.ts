/**
 * Bell schedule display helpers.
 *
 * The bell parser emits 24-hour "HH:MM" times; the Bell section renders
 * 12-hour times ("7:10", "1:30") with no AM/PM suffix, per the design
 * target. Tab labels stored by intake ("Daily 9-period", "WEB 14-row")
 * are shortened to the "Daily" / "WEB Days" pills.
 */

/**
 * "7:10" / "07:10" / "13:30" -> "7:10" / "1:30" (12-hour, no AM/PM suffix).
 * Strings that aren't times pass through untouched.
 */
export function formatBellTime(t: string): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([aApP])\.?\s*[mM]\.?)?$/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3]?.toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min}`;
}

/**
 * Pill-tab display label for a bell schedule source. Intake stores labels
 * like "Daily 9-period" / "WEB 14-row"; the section shows the short
 * "Daily" / "WEB Days" pills from the design target.
 */
export function bellTabLabel(raw: string | undefined, index: number): string {
  const label = (raw ?? "").trim();
  const lower = label.toLowerCase();
  if (lower.includes("web")) return "WEB Days";
  if (lower.includes("daily")) return "Daily";
  return label || `Schedule ${index + 1}`;
}
