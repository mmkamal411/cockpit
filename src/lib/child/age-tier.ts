/**
 * Age tiers for child pilots — enforced in code, not just comments.
 *
 *   under13    — COPPA: no account. Parent stewardship only.
 *   teen-13-15 — shared agency: claim + explicit consent; 7-day cooling-off
 *                on steward-initiated revokes.
 *   teen-16-17 — independence: instant, fully reversible revokes.
 *   adult-18+  — continuity: one prompt, keep history, manage anytime.
 *
 * Pure functions (no DB, no auth) so the tier logic has a single source of
 * truth shared by the invite gate, the claim RPC, and the sharing screen.
 * Unit-testable: pass `at` to freeze "today".
 */

export type AgeTier = "under13" | "teen-13-15" | "teen-16-17" | "adult-18+" | "unknown";

/** Whole years of age on the given date. -1 when the birthdate is unusable. */
export function ageAt(birthdate: string | null | undefined, at: Date = new Date()): number {
  if (!birthdate) return -1;
  const born = new Date(`${birthdate}T00:00:00`);
  if (Number.isNaN(born.getTime())) return -1;
  let age = at.getFullYear() - born.getFullYear();
  const beforeBirthday =
    at.getMonth() < born.getMonth() ||
    (at.getMonth() === born.getMonth() && at.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** The tier for a birthdate. "unknown" when there is no usable birthdate. */
export function ageTier(
  birthdate: string | null | undefined,
  at: Date = new Date(),
): AgeTier {
  const age = ageAt(birthdate, at);
  if (age < 0) return "unknown";
  if (age < 13) return "under13";
  if (age < 16) return "teen-13-15";
  if (age < 18) return "teen-16-17";
  return "adult-18+";
}

/** True for pilots who signed in as a child (13+) rather than a parent. */
export function isChildTier(tier: AgeTier): boolean {
  return tier === "teen-13-15" || tier === "teen-16-17" || tier === "adult-18+";
}

/** Days a steward-initiated revoke waits before taking effect. 0 = instant. */
export function revokeCoolingOffDays(tier: AgeTier): number {
  return tier === "teen-13-15" ? 7 : 0;
}

/** Short plain-English label for the tier, used across the UI. */
export function tierLabel(tier: AgeTier): string {
  switch (tier) {
    case "under13":
      return "Under 13";
    case "teen-13-15":
      return "13–15 · shared";
    case "teen-16-17":
      return "16–17 · independent";
    case "adult-18+":
      return "18+ · adult";
    default:
      return "Age not set";
  }
}

/**
 * One-line plain-English explainer shown on the invite/claim screens.
 * `name` is the child's first name.
 */
export function tierExplainer(tier: AgeTier, name: string): string {
  switch (tier) {
    case "under13":
      return `Cockpit accounts start at 13 — for now, you manage everything about ${name}'s school right here. You're their steward.`;
    case "teen-13-15":
      return `${name} gets their own sign-in and says yes to exactly what you can see. Either of you can pause sharing anytime.`;
    case "teen-16-17":
      return `${name} is in charge of who sees their school life. Sharing changes take effect right away and can always be undone.`;
    case "adult-18+":
      return `${name} is an adult now — they're in control. What you could see before stays visible unless they change it.`;
    default:
      return "Add a birthdate to see how sharing works for this age.";
  }
}

/** What a consenting parent WILL see — the consent screen's left column. */
export function consentWillSee(tier: AgeTier): string[] {
  const base = [
    "Your classes and grades",
    "Missing and upcoming assignments",
    "Attendance — absences and tardies",
  ];
  if (tier === "teen-13-15") {
    return [...base, "Your daily check-ins, word for word"];
  }
  if (tier === "teen-16-17") {
    return [...base, "Your daily check-ins (you can turn this off anytime)"];
  }
  return [...base, "Your daily check-ins"];
}

/** What stays private no matter what — the consent screen's right column. */
export function consentWillNotSee(): string[] {
  return [
    "Your Crystal chats — those are just between you and Crystal",
    'Notes you mark "just for me"',
    "Which resources or links you open",
    "Anything you delete",
  ];
}

/** Plain-English rendering of the child-is-authority rule (16–17 screen). */
export const CHILD_AUTHORITY_COPY =
  "You're the one who decides. Only you can change who sees your school life — one parent can't undo what the other was given, and nobody can change it behind your back.";
