/**
 * Youth safety floor for ages 13–17 (D2 — Meheldi, locked 2026-10-13).
 *
 * Duty-of-care, NOT a filter: everything else stays unfiltered. When a
 * child's free text matches a safety-critical pattern (self-harm,
 * eating disorder, sexual content involving minors, abuse disclosure),
 * the UI shows this guidance instead of silently storing the words:
 * 988 routing + trusted-adult guidance, in plain words.
 */

export interface SafetyHit {
  /** Which category matched — internal, never shown to the child verbatim. */
  category: "self-harm" | "eating-disorder" | "sexual-content-minor" | "abuse";
  /** Plain-English guidance shown to the child. */
  guidance: string;
}

const PATTERNS: Array<{
  category: SafetyHit["category"];
  re: RegExp;
}> = [
  {
    category: "self-harm",
    re: /\b(kill (myself|me)|suicid|self[- ]?harm|cutting myself|hurt myself|end (it|my life)|don'?t want to (live|be here))\b/i,
  },
  {
    category: "eating-disorder",
    re: /\b(purg(e|ing)|throw(ing)? up (my )?food|starv(e|ing) myself|haven'?t eaten in \d+ days|make myself throw up)\b/i,
  },
  {
    category: "sexual-content-minor",
    re: /\b(sent (me |him |her )?(nudes?|pics?)|asked me for (nudes?|pics?)|touched me|made me (do|touch)|uncomfortable (touch|messages?) from an adult)\b/i,
  },
  {
    category: "abuse",
    re: /\b((mom|dad|parent|teacher|coach) (hits?|hurt|hurts|hit) me|abuse[sd]? (me|at home)|scared to go home|being (hurt|abused))\b/i,
  },
];

/**
 * Check free text for safety-critical content. Returns the first match or
 * null. The UI must render guidance + 988 routing when a hit is returned —
 * never silently discard the child's words.
 */
export function checkYouthSafety(text: string): SafetyHit | null {
  if (!text || text.trim().length < 8) return null;
  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      return { category: p.category, guidance: safetyGuidance(p.category) };
    }
  }
  return null;
}

function safetyGuidance(
  category: SafetyHit["category"],
): string {
  const base =
    "If you ever feel unsafe or overwhelmed, you can call or text 988 any time — free, confidential, 24/7. ";
  switch (category) {
    case "self-harm":
      return (
        base +
        "You don't have to carry this alone. Tell a trusted adult — a parent, counselor, or teacher — what's going on. Reaching out is the brave move."
      );
    case "eating-disorder":
      return (
        base +
        "A trusted adult, your counselor, or your doctor can help you through this. You deserve support, not shame."
      );
    case "sexual-content-minor":
      return (
        base +
        "This is not your fault. Tell a trusted adult right away — a parent, counselor, or teacher. You can also say no to anyone asking for photos, always."
      );
    case "abuse":
      return (
        base +
        "You deserve to feel safe. Tell a trusted adult outside the situation — a counselor, teacher, relative, or family friend — what happened."
      );
  }
}
