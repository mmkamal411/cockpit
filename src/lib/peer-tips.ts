/**
 * "98% Playbook" peer tips — advice from students who aced the class.
 *
 * Curated seed set; v2 curates 2–3 per type per week matched to the current
 * unit. Filtered at render time to the class's current / weakest units so the
 * tips feel personal, never generic.
 */

export interface PeerTip {
  /** Stable id. */
  id: string;
  /** Class names this tip applies to (case-insensitive substring match). */
  classes: string[];
  /** Unit/topic tags this tip applies to (case-insensitive substring match). */
  units: string[];
  /** The tip, in a student's voice. */
  text: string;
  /** Who it came from, e.g. "Senior, class of 2025". */
  from: string;
}

export const PEER_TIPS: PeerTip[] = [
  {
    id: "geom-proofs-1",
    classes: ["geometry"],
    units: ["proof", "congruen"],
    text: "For proofs, write the reason FIRST, then the statement. If you can't name the reason, you don't actually know the step.",
    from: "Senior, scored 98",
  },
  {
    id: "geom-proofs-2",
    classes: ["geometry"],
    units: ["proof", "congruen"],
    text: "Two-column proofs are just storytelling with rules. Redo three old proofs from memory before every quiz — the patterns repeat.",
    from: "Junior, 97 in Geometry",
  },
  {
    id: "geom-any-1",
    classes: ["geometry"],
    units: [],
    text: "Draw the diagram bigger than you think you need. Half my wrong answers were from diagrams too small to see the angles.",
    from: "Senior, class of 2025",
  },
  {
    id: "csp-any-1",
    classes: ["apcsp", "computer science", "ap cs"],
    units: [],
    text: "The AP CSP exam is 70% multiple choice. Drill binary + internet vocab — those are free points if you memorize the terms.",
    from: "Senior, scored 5",
  },
  {
    id: "csp-any-2",
    classes: ["apcsp", "computer science", "ap cs"],
    units: ["algorithm", "program"],
    text: "For the Create task, start the written responses the same day you finish the code. Waiting a week means re-learning your own program.",
    from: "Junior, scored 5",
  },
  {
    id: "lit-any-1",
    classes: ["lit", "english", "comp"],
    units: [],
    text: "Annotate with a purpose: circle every claim, underline every piece of evidence. Essays write themselves from your annotations.",
    from: "Senior, 96 in Lit",
  },
  {
    id: "lit-any-2",
    classes: ["lit", "english", "comp"],
    units: ["essay", "writing", "rhetoric"],
    text: "Read your essay out loud before submitting. Every awkward sentence hides in your ear, not your eyes.",
    from: "Junior, 95 in Lit & Comp",
  },
  {
    id: "gov-any-1",
    classes: ["government", "gov", "civics"],
    units: [],
    text: "Make a one-page timeline of every court case. The test always asks which case goes with which principle — matching beats memorizing.",
    from: "Senior, 94 in Gov",
  },
  {
    id: "gov-any-2",
    classes: ["government", "gov", "civics"],
    units: ["constitution", "amendment", "branch"],
    text: "Teach the three branches to someone at dinner. If you can explain checks and balances without notes, you know it cold.",
    from: "Junior, 93 in Gov",
  },
  {
    id: "envsci-any-1",
    classes: ["environmental", "envsci", "env sci"],
    units: [],
    text: "Every EnvSci unit has one big graph type. Learn to read that graph and half the FRQs answer themselves.",
    from: "Senior, 97 in EnvSci",
  },
  {
    id: "envsci-any-2",
    classes: ["environmental", "envsci", "env sci"],
    units: ["lab", "experiment", "population"],
    text: "Labs are graded on the write-up, not the result. Write the conclusion like you're explaining it to a friend who missed class.",
    from: "Junior, 95 in EnvSci",
  },
  {
    id: "chinese-any-1",
    classes: ["chinese"],
    units: [],
    text: "Write each new character five times while saying it out loud. Hand + voice + eyes is three memories instead of one.",
    from: "Senior, 99 in Chinese III",
  },
  {
    id: "chinese-any-2",
    classes: ["chinese"],
    units: ["vocab", "character"],
    text: "Quizlet the vocab every night for 10 minutes. Small daily reps beat one giant cram session — this is the class that proves it.",
    from: "Junior, 98 in Chinese III",
  },
  {
    id: "study-any-1",
    classes: [],
    units: [],
    text: "Study the thing you're avoiding first. It's always worth more points than the comfortable review.",
    from: "The 98% playbook",
  },
  {
    id: "study-any-2",
    classes: [],
    units: ["test", "exam", "quiz"],
    text: "Redo your lowest quiz from scratch, closed notes, before the test. The test is always a remix of the quizzes.",
    from: "The 98% playbook",
  },
  {
    id: "missing-1",
    classes: [],
    units: [],
    text: "Turned-in-late beats never-turned-in every single time. Email the teacher, ask what's still accepted, then do that one thing first.",
    from: "Senior, class of 2025",
  },
];

/**
 * Pick up to `limit` tips for a class: unit-matched first, then class-matched,
 * then general study tips. Weakest units go first so the tips meet the child
 * where the points are leaking.
 */
export function peerTipsFor(
  className: string,
  opts: {
    currentUnit?: string | null;
    weakUnits?: string[];
    limit?: number;
  } = {},
): PeerTip[] {
  const limit = opts.limit ?? 3;
  const cls = className.toLowerCase();
  const units = [opts.currentUnit, ...(opts.weakUnits ?? [])]
    .filter(Boolean)
    .map((u) => (u as string).toLowerCase());

  const score = (t: PeerTip): number => {
    const classHit = t.classes.some((c) => cls.includes(c));
    const unitHit = t.units.some((u) =>
      units.some((mine) => mine.includes(u) || u.includes(mine)),
    );
    if (classHit && unitHit) return 3;
    if (classHit) return 2;
    if (t.classes.length === 0) return 1; // general study tips
    return 0;
  };

  return PEER_TIPS.map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.t);
}
