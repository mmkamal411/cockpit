/**
 * Morning spark — the delight-first card on the child Home.
 *
 * Bundled, pre-reviewed daily pack (v1): no live LLM generation for kids'
 * delight content. The pack rotates by day-of-year so every morning feels
 * a little different, and it works fully offline. Facts are science/nature
 * tidbits; quotes are short, encouraging, and attributed.
 */

export interface MorningSpark {
  fact: string;
  quote: string;
  quoteBy: string;
}

const FACTS: string[] = [
  "Honey never spoils — archaeologists have tasted 3,000-year-old honey and it was still good.",
  "Octopuses have three hearts, and two of them stop beating when they swim.",
  "A day on Venus is longer than a year on Venus.",
  "Bananas are berries, but strawberries aren't — botany is weird.",
  "Your brain runs on about 20 watts — enough to dimly light a bulb.",
  "Sharks existed before trees. By about 50 million years.",
  "There are more stars in the universe than grains of sand on all of Earth's beaches.",
  "Wombat poop is cube-shaped. Scientists figured out why in 2018.",
  "A single bolt of lightning is five times hotter than the surface of the sun.",
  "Sea otters hold hands while they sleep so they don't drift apart.",
  "The Eiffel Tower grows about 15 cm taller in summer from the metal expanding.",
  "Cleopatra lived closer in time to the iPhone than to the building of the pyramids.",
  "Your taste buds have a lifespan of about two weeks — you're literally always getting new ones.",
  "It rains diamonds on Neptune and Uranus. Really.",
];

const QUOTES: { text: string; by: string }[] = [
  { text: "Small steps every day.", by: "Unknown" },
  { text: "You don't have to be perfect to make progress.", by: "Unknown" },
  { text: "Done is better than perfect.", by: "Sheryl Sandberg" },
  { text: "The expert in anything was once a beginner.", by: "Helen Hayes" },
  { text: "It always seems impossible until it's done.", by: "Nelson Mandela" },
  { text: "Start where you are. Use what you have. Do what you can.", by: "Arthur Ashe" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", by: "Robert Collier" },
  { text: "Don't watch the clock; do what it does. Keep going.", by: "Sam Levenson" },
  { text: "You are braver than you believe, stronger than you seem, and smarter than you think.", by: "A.A. Milne" },
  { text: "The future depends on what you do today.", by: "Mahatma Gandhi" },
  { text: "Little by little, a little becomes a lot.", by: "Tanzanian proverb" },
  { text: "Discipline is choosing what you want most over what you want now.", by: "Unknown" },
  { text: "Whether you think you can or you think you can't, you're right.", by: "Henry Ford" },
  { text: "Every morning is a fresh start.", by: "Unknown" },
];

/** Deterministic pick for a date — same day, same spark, everywhere. */
export function getMorningSpark(forDate: Date = new Date()): MorningSpark {
  const start = new Date(forDate.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((forDate.getTime() - start.getTime()) / 86400000);
  const fact = FACTS[dayOfYear % FACTS.length];
  const q = QUOTES[dayOfYear % QUOTES.length];
  return { fact, quote: q.text, quoteBy: q.by };
}
