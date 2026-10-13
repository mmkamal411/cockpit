/**
 * Morning spark — daily delight bundle: one fun fact + one quote.
 *
 * Curated content ported AS-IS from Pookie (pookie-app/src/lib/school/trivia.ts
 * and pookie-app/src/lib/daily/quotes.ts). The 30 quotes were written by Meheldi
 * himself; the facts are the curated TRIVIA_FACTS list. No API, no LLM, zero
 * infra — deterministic rotation so the whole family sees the same fact and
 * quote on the same calendar day.
 */

/* ------------------------------------------------------------------ */
/* Fun facts — ported from pookie-app/src/lib/school/trivia.ts          */
/* ------------------------------------------------------------------ */

export interface TriviaFact {
  text: string;
  source: string;
  sourceUrl?: string;
}

export const TRIVIA_FACTS: TriviaFact[] = [
  {
    text: "Honey never spoils — archaeologists found 3,000-year-old honey in Egyptian tombs that was still edible.",
    source: "Smithsonian",
    sourceUrl: "https://www.si.edu",
  },
  {
    text: "Octopuses have three hearts and blue blood — two hearts stop beating when they swim, which is why they prefer crawling.",
    source: "National Geographic",
    sourceUrl: "https://www.nationalgeographic.com",
  },
  {
    text: "The Eiffel Tower grows about 15 cm taller in summer as its iron expands in the heat.",
    source: "Toureiffel.paris",
    sourceUrl: "https://www.toureiffel.paris",
  },
  {
    text: "Your brain generates about 20 watts of electrical power — enough to dimly light a bulb.",
    source: "Neuroscience",
  },
  {
    text: "Geometry's proofs use the same logic as computer programs: assumptions in, conclusions out, no skipped steps.",
    source: "Study Insight",
  },
  {
    text: "Students who explain a lesson out loud (the protégé effect) remember up to 90% of it a week later.",
    source: "Learning Science",
  },
  {
    text: "AP Computer Science Principles covers binary, algorithms, and the internet — the exam is 70% multiple choice.",
    source: "College Board",
    sourceUrl: "https://apstudents.collegeboard.org",
  },
  {
    text: "Chinese characters are logograms: each one represents a meaning, not a sound — there are over 50,000 in total.",
    source: "Language Facts",
  },
  {
    text: "The American government has three branches by design — Congress, the President, and the courts check each other's power.",
    source: "Civics",
  },
  {
    text: "Environmental science studies how populations grow: exponential growth looks flat until it suddenly doesn't.",
    source: "Study Insight",
  },
  {
    text: "Shakespeare invented or popularized over 1,700 English words — including 'eyeball', 'bedroom', and 'fashionable'.",
    source: "Oxford English Dictionary",
    sourceUrl: "https://www.oed.com",
  },
  {
    text: "Sleep is when your brain files away the day's learning — a full night's sleep beats an all-nighter every time.",
    source: "Sleep Science",
  },
  {
    text: "The HOPE Scholarship needs a 3.0 GPA in core classes — every tenth of a point counts.",
    source: "GAfutures",
    sourceUrl: "https://www.gafutures.org",
  },
  {
    text: "Missing work is the fastest grade killer: a single zero can drag a category average down by double digits.",
    source: "Study Insight",
  },
];

/* ------------------------------------------------------------------ */
/* Daily quotes — ported from pookie-app/src/lib/daily/quotes.ts        */
/* (Meheldi wrote all 30; seeded rotation, no repeats in 30 days)       */
/* ------------------------------------------------------------------ */

export interface Quote {
  text: string;
  source: string;
}

export const QUOTES: Quote[] = [
  { text: "Discipline is choosing what you want most over what you want now.", source: "Fight-mode fuel" },
  { text: "You don't have to be perfect. You have to be consistent.", source: "Fight-mode fuel" },
  { text: "Small wins, stacked daily, become unstoppable.", source: "Fight-mode fuel" },
  { text: "The test doesn't care how you feel. Prepare anyway.", source: "Fight-mode fuel" },
  { text: "An hour of focused work beats three hours of staring.", source: "Study note" },
  { text: "Champions are made when no one is watching.", source: "Fight-mode fuel" },
  { text: "Your future self is watching today's choices.", source: "Fight-mode fuel" },
  { text: "Start ugly. A rough draft beats a blank page.", source: "Study note" },
  { text: "The grade you want lives on the other side of the work you're avoiding.", source: "Fight-mode fuel" },
  { text: "Sleep is a study strategy. Protect it.", source: "Study note" },
  { text: "Confusion is the feeling of learning happening.", source: "Study note" },
  { text: "Ninety percent is a decision, not a gift.", source: "Fight-mode fuel" },
  { text: "Do the hardest thing first. The day gets easier from there.", source: "Study note" },
  { text: "Nobody remembers the score. Everybody remembers the effort.", source: "Fight-mode fuel" },
  { text: "Review beats reread. Test yourself, don't just look.", source: "Study note" },
  { text: "You are one focused week away from a different transcript.", source: "Fight-mode fuel" },
  { text: "Missing work is a choice. So is turning it in.", source: "Study note" },
  { text: "The OR is quiet, precise, and calm under pressure. Train like that now.", source: "Future Dr. Kamal" },
  { text: "A surgeon never wings it. Neither do you.", source: "Future Dr. Kamal" },
  { text: "Every problem set is practice for the problems that matter.", source: "Future Dr. Kamal" },
  { text: "Boring consistency beats exciting intensity.", source: "Fight-mode fuel" },
  { text: "Ask the question. Teachers respect the kid who cares.", source: "Study note" },
  { text: "Your competition is yesterday's version of you.", source: "Fight-mode fuel" },
  { text: "Twenty-five focused minutes. Then another. That's the whole secret.", source: "Study note" },
  { text: "Mistakes are data. Log them, learn them, leave them behind.", source: "Study note" },
  { text: "The students who ask for help finish ahead of the ones who don't.", source: "Study note" },
  { text: "Finish today's work today. Tomorrow has its own.", source: "Fight-mode fuel" },
  { text: "Calm is a competitive advantage. Breathe, then begin.", source: "Future Dr. Kamal" },
  { text: "You don't rise to the occasion. You fall to your preparation.", source: "Fight-mode fuel" },
  { text: "One more rep. One more problem. One more page. Then rest.", source: "Fight-mode fuel" },
];

/* ------------------------------------------------------------------ */
/* Seeded RNG + daily rotation (ported from pookie-app)                 */
/* ------------------------------------------------------------------ */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Days since Unix epoch for a YYYY-MM-DD date string (local, no TZ drift). */
function dayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function todayStr(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function rotationPick<T>(bank: T[], dateStr: string, count: number): T[] {
  if (bank.length === 0) return [];
  const windowDays = Math.max(1, Math.floor(bank.length / count));
  const day = dayNumber(dateStr);
  const epoch = Math.floor(day / windowDays);
  const offset = (day % windowDays) * count;
  const shuffled = seededShuffle(bank, hashString(`epoch-${epoch}`));
  const out: T[] = [];
  for (let i = 0; i < count; i++)
    out.push(shuffled[(offset + i) % shuffled.length]);
  return out;
}

/* ------------------------------------------------------------------ */
/* Public pickers                                                       */
/* ------------------------------------------------------------------ */

export function triviaForDate(dateStr: string = todayStr()): TriviaFact {
  const [f] = rotationPick(TRIVIA_FACTS, dateStr, 1);
  return f ?? TRIVIA_FACTS[0];
}

export function quoteForDate(dateStr: string = todayStr()): Quote {
  const [q] = rotationPick(QUOTES, dateStr, 1);
  return q ?? QUOTES[0];
}

export interface MorningSpark {
  fact: TriviaFact;
  quote: Quote;
  date: string;
}

/** One fun fact + one daily quote — stable for the whole calendar day. */
export function morningSparkFor(dateStr: string = todayStr()): MorningSpark {
  return {
    fact: triviaForDate(dateStr),
    quote: quoteForDate(dateStr),
    date: dateStr,
  };
}
