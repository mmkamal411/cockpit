/**
 * Crystal Chat mode logic — shared, pure, and unit-tested.
 * The applet and (later) the server import from here so the keyword
 * routing has a single source of truth.
 */

export type Persona = "crystal" | "fireball";

export const PERSONA_LABEL: Record<Persona, string> = {
  crystal: "Crystal",
  fireball: "Fireball",
};

/**
 * Mode keywords (module spec §3):
 *  - "fireball" → Fireball (direct, unfiltered)
 *  - "crystal" / "more" / "details" / "explain" / "plan" / "describe" /
 *    "create" → Crystal (or expansion of the last answer)
 */
const FIREBALL_RE = /\bfireball\b/i;
const CRYSTAL_RE = /\b(?:crystal|more|details|explain|plan|describe|create)\b/i;

/**
 * Detect the persona from keywords in the message.
 * An explicit "fireball" wins when both appear. Defaults to "crystal".
 */
export function detectPersona(text: string): Persona {
  if (FIREBALL_RE.test(text)) return "fireball";
  if (CRYSTAL_RE.test(text)) return "crystal";
  return "crystal";
}

/**
 * Strip a leading directive keyword ("fireball …", "hey crystal, …").
 * Mid-sentence mentions are left alone — they're content, not commands.
 * Returns the original text when stripping would leave nothing.
 */
export function stripDirective(text: string, persona: Persona): string {
  const stripped = text.replace(
    new RegExp(`^(hey[ ,]+)?\\b${persona}\\b[,:\\s]*`, "i"),
    "",
  );
  const clean = stripped.trim();
  return clean ? clean : text;
}

/** One-line confirmation for a mode flip (keyword or pill tap). */
export function flipConfirmation(persona: Persona): string {
  return persona === "fireball"
    ? "Switched to Fireball — direct, numbers-first, no softening."
    : "Switched to Crystal — warm and steady.";
}
