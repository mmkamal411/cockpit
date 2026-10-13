/**
 * D2 safety floor — duty of care for Crystal chat with 13–17 pilots.
 *
 * This is crisis routing, NOT a content filter. Normal conversation stays
 * completely unfiltered: this layer only fires when a child's message
 * matches one of four narrow crisis patterns, and then Crystal answers with
 * a warm, caring 988 / trusted-adult response instead of the LLM reply.
 *
 * v1 is keyword/pattern matching — deliberately narrow, documented limits:
 * it can miss euphemisms and it can misfire on quoted/figurative language.
 * It must never silently swallow a message: on a match we still persist both
 * messages to the thread and return the caring response in the normal shape.
 */

export type CrisisKind =
  | "self-harm"
  | "eating-disorder"
  | "sexual-content-minor"
  | "abuse";

const PATTERNS: Record<CrisisKind, RegExp[]> = {
  "self-harm": [
    /\bkills?\s+(myself|me)\b/i,
    /\bkilling\s+myself\b/i,
    /\bcut(?:s|ting)?\s+myself\b/i,
    /\bhurt(?:s|ing)?\s+myself\b/i,
    /\bend\s+my\s+life\b/i,
    /\bwants?\s+to\s+die\b/i,
    /\b(don'?t|do\s+not)\s+wants?\s+to\s+(be\s+here|live)\s+anymore\b/i,
    /\bsuicid(?:e|al)\b/i,
    /\bself[\s-]?harm\b/i,
    /\bthoughts?\s+of\s+(dying|death|killing\s+myself)\b/i,
  ],
  "eating-disorder": [
    /\banorexi[ac]\b/i,
    /\bbulimi[ac]\b/i,
    /\bbinge\s+and\s+purge\b/i,
    /\bmak(?:e|ing)\s+myself\s+throw\s+up\b/i,
    /\bthrow(?:ing)?\s+up\s+(my\s+)?food\b/i,
    /\bstarv(?:e|ing)\s+myself\b/i,
    /\bpurge\s+after\s+eating\b/i,
  ],
  "sexual-content-minor": [
    /\b(?:asked?|wants?|telling|told)\s+me\s+to\s+send\s+(nudes?|naked\s+pics?|explicit\s+pics?)\b/i,
    /\bsent\s+me\s+(nudes?|explicit\s+(pics?|photos?|images?))\b/i,
    /\btouched\s+me\s+(inappropriately|in\s+private|down\s+there|where\s+they\s+shouldn'?t)\b/i,
    /\bhad\s+sex\s+with\s+me\b/i,
    /\braped?\s+me\b/i,
    /\bmolested?\s+me\b/i,
    /\bsexual\s+assault\b/i,
  ],
  abuse: [
    /\bmy\s+(dad|mom|father|mother|stepdad|stepmom|stepfather|stepmother|uncle|aunt|brother|sister|teacher|coach|babysitter)\s+(hits?|beats?|hurts?|hurting|slaps?|punches?)\s+me\b/i,
    /\bbeats?\s+me\s+(up\s+)?(at\s+home\s+)?(every|all\s+the\s+time|sometimes)?/i,
    /\babus(?:e[sd]?|ing)\s+me\b/i,
    /\bscared\s+to\s+go\s+home\b/i,
  ],
};

/**
 * Returns the crisis kind when the message matches one of the four narrow
 * patterns, otherwise null. Order matters: a message matching several kinds
 * is routed to the first (most acute) one.
 */
export function detectCrisis(text: string): CrisisKind | null {
  const kinds: CrisisKind[] = ["self-harm", "sexual-content-minor", "abuse", "eating-disorder"];
  for (const kind of kinds) {
    if (PATTERNS[kind].some((re) => re.test(text))) return kind;
  }
  return null;
}

const FIRST_NAME = (name: string | null | undefined): string =>
  name && name.trim() ? ` ${name.trim().split(" ")[0]}` : "";

/**
 * The caring duty-of-care response. Warm first-person, no lecture, no
 * judgment — then the concrete next steps: 988, a text line, and a trusted
 * adult today. Copy is teen-readable, not clinical.
 */
export function crisisResponse(kind: CrisisKind, name?: string | null): string {
  const n = FIRST_NAME(name);
  switch (kind) {
    case "self-harm":
      return (
        `Thank you for telling me${n} — that took real courage, and I'm taking it seriously.\n\n` +
        `You don't have to carry these thoughts alone. If you feel like you might act on them, ` +
        `please call or text **988** right now — it's free, confidential, and someone is there 24/7. ` +
        `You can also text HOME to 741741 to reach the Crisis Text Line.\n\n` +
        `And today, please tell one adult you trust — a parent, a school counselor, a teacher, a coach. ` +
        `You deserve support from a real person who can be there with you, not just me.\n\n` +
        `I'm still here, and we can keep talking about anything else whenever you're ready.`
      );
    case "eating-disorder":
      return (
        `I'm glad you trusted me with this${n}. Struggling with food and your body is painful, and you don't have to face it alone.\n\n` +
        `There are people who help with exactly this, any time: call or text **988** (free, 24/7), ` +
        `or reach the National Eating Disorders Association helpline at **1-800-931-2237**.\n\n` +
        `Please also tell a trusted adult — a parent, your doctor, or a school counselor — so someone in your real life can walk with you through it. ` +
        `Getting help is a strong move, not a weak one.\n\n` +
        `I'm here for everything else, whenever you want to talk.`
      );
    case "sexual-content-minor":
      return (
        `Thank you for telling me${n}. I want you to hear this clearly: what you're describing is not okay, and it is not your fault — not even a little.\n\n` +
        `The most important thing is telling a safe adult right away: a parent, a school counselor, or another adult you trust. ` +
        `If you ever feel unsafe right now, call **911**. You can also call or text **988** any time to talk it through with someone trained to help.\n\n` +
        `You did the right thing by saying something. Keep saying it until someone helps — and I'm here too.`
      );
    case "abuse":
      return (
        `I'm really glad you told me${n}. Nobody deserves to be hurt — not by anyone, ever — and this is not your fault.\n\n` +
        `Please tell a safe adult as soon as you can: another parent, a relative, a school counselor, or a teacher you trust. ` +
        `You can also call the Childhelp National Child Abuse Hotline at **1-800-422-4453** (free, 24/7), or call or text **988**. ` +
        `If you're in danger right now, call **911**.\n\n` +
        `You were brave to say this out loud. Keep telling safe people until you get help — I'm here with you.`
      );
  }
}
