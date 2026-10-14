/**
 * Station registry — the single inventory of every station on the ship.
 *
 * Shared by all three station-deck showcase variants (bays / ecam / grid)
 * so the only difference between variants is presentation, never content.
 *
 * A station is either LIVE (appletId maps to an entry in APPLETS and can be
 * opened) or a SEEDLING (appletId is null — blurb + "notify me" CTA only).
 *
 * Display names use Meheldi's approved renames: Family (was Crew),
 * Reminders (was Nudges), Learning (was Learn).
 */

export type BayId = "you" | "day" | "money" | "people" | "trips";

export interface BayDef {
  id: BayId;
  /** Plain-language bay name — grandmother test. */
  name: string;
}

export const BAYS: BayDef[] = [
  { id: "you", name: "You" },
  { id: "day", name: "Your Day" },
  { id: "money", name: "Money & Home" },
  { id: "people", name: "People" },
  { id: "trips", name: "Trips & Files" },
];

export interface StationPreview {
  /** Lazy-fetched on station select only — never on deck mount. */
  endpoint: string;
  /** Extract one short live datum from the JSON, or null when unavailable. */
  pick: (json: unknown) => string | null;
}

export interface StationDef {
  id: string;
  /** Display name (approved renames applied). */
  name: string;
  /** One-line plain-English description. */
  blurb: string;
  /** Neon accent for the station's LED / bezel glow. */
  glow: string;
  bay: BayId;
  /** APPLETS key, or null for seedlings. */
  appletId: string | null;
  preview?: StationPreview;
}

/** Defensive picker helper — never throws, returns null on any mismatch. */
function safe(fn: () => string | null): (json: unknown) => string | null {
  return () => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
}

export const STATIONS: StationDef[] = [
  // ---- YOU ----
  {
    id: "health",
    name: "Health",
    blurb: "Sleep, movement, and how your body is really doing.",
    glow: "#86efac",
    bay: "you",
    appletId: "health",
    preview: {
      endpoint: "/api/today",
      pick: safe(() => null), // wired after showcase winner is picked
    },
  },
  {
    id: "fitness",
    name: "Fitness",
    blurb: "Workouts and activity, tracked without the guilt.",
    glow: "#86efac",
    bay: "you",
    appletId: null,
  },
  {
    id: "sleep",
    name: "Sleep",
    blurb: "Nights that set up your days.",
    glow: "#67e8f9",
    bay: "you",
    appletId: null,
  },
  {
    id: "meals",
    name: "Meals",
    blurb: "What you eat, noticed gently.",
    glow: "#fcd34d",
    bay: "you",
    appletId: null,
  },
  {
    id: "learning",
    name: "Learning",
    blurb: "Skills and courses, one calm session at a time.",
    glow: "#67e8f9",
    bay: "you",
    appletId: null,
  },
  {
    id: "goals",
    name: "Goals",
    blurb: "Where you're headed, and the next small step.",
    glow: "#c4b5fd",
    bay: "you",
    appletId: null,
  },
  // ---- YOUR DAY ----
  {
    id: "calendar",
    name: "Calendar",
    blurb: "Your day, laid out calmly.",
    glow: "#f0abfc",
    bay: "day",
    appletId: "calendar",
    preview: {
      endpoint: "/api/today",
      pick: safe(() => null),
    },
  },
  {
    id: "todos",
    name: "To-dos",
    blurb: "The few things that matter today.",
    glow: "#67e8f9",
    bay: "day",
    appletId: null,
    preview: {
      endpoint: "/api/today",
      pick: safe(() => null),
    },
  },
  {
    id: "reminders",
    name: "Reminders",
    blurb: "Gentle reminders before things slip.",
    glow: "#fcd34d",
    bay: "day",
    appletId: "nudges",
    preview: {
      endpoint: "/api/today",
      pick: safe(() => null),
    },
  },
  {
    id: "weather",
    name: "Weather",
    blurb: "Skies above you, hour by hour.",
    glow: "#67e8f9",
    bay: "day",
    appletId: "weather",
  },
  {
    id: "news",
    name: "News",
    blurb: "The world, filtered for signal.",
    glow: "#94a3b8",
    bay: "day",
    appletId: null,
  },
  // ---- MONEY & HOME ----
  {
    id: "money",
    name: "Money",
    blurb: "Bills, spending, and the quiet leaks in your budget.",
    glow: "#fcd34d",
    bay: "money",
    appletId: null,
  },
  {
    id: "bills",
    name: "Bills",
    blurb: "What's due, before it's late.",
    glow: "#fcd34d",
    bay: "money",
    appletId: "bills",
    preview: {
      endpoint: "/api/today",
      pick: safe(() => null),
    },
  },
  {
    id: "subscriptions",
    name: "Subscriptions",
    blurb: "Every recurring charge, in one place.",
    glow: "#fcd34d",
    bay: "money",
    appletId: "subscriptions",
  },
  {
    id: "shopping",
    name: "Shopping",
    blurb: "Lists that notice when you're running low.",
    glow: "#5eead4",
    bay: "money",
    appletId: "shopping",
  },
  {
    id: "properties",
    name: "Properties",
    blurb: "Your places, watched over.",
    glow: "#5eead4",
    bay: "money",
    appletId: null,
  },
  // ---- PEOPLE ----
  {
    id: "mail",
    name: "Mail",
    blurb: "Every inbox, triaged — the important stuff floats up.",
    glow: "#67e8f9",
    bay: "people",
    appletId: null,
  },
  {
    id: "messages",
    name: "Messages",
    blurb: "Conversations that need you.",
    glow: "#67e8f9",
    bay: "people",
    appletId: null,
  },
  {
    id: "family",
    name: "Family",
    blurb: "Your family, and their school life.",
    glow: "#86efac",
    bay: "people",
    appletId: "crew",
  },
  {
    id: "school",
    name: "School",
    blurb: "Classes, grades, and what's due.",
    glow: "#86efac",
    bay: "people",
    appletId: null,
  },
  // ---- TRIPS & FILES ----
  {
    id: "travel",
    name: "Travel",
    blurb: "Flights, stays, and trips that plan themselves.",
    glow: "#c4b5fd",
    bay: "trips",
    appletId: null,
  },
  {
    id: "flights",
    name: "Flights",
    blurb: "Your wings, tracked gate to gate.",
    glow: "#c4b5fd",
    bay: "trips",
    appletId: null,
  },
  {
    id: "charging",
    name: "Charging",
    blurb: "Power for the road, cheapest nearby.",
    glow: "#5eead4",
    bay: "trips",
    appletId: null,
  },
  {
    id: "documents",
    name: "Documents",
    blurb: "Important papers, findable in seconds.",
    glow: "#94a3b8",
    bay: "trips",
    appletId: null,
  },
  {
    id: "notes",
    name: "Notes",
    blurb: "Thoughts, kept where you'll find them.",
    glow: "#94a3b8",
    bay: "trips",
    appletId: null,
  },
];

/** Stations grouped by bay, in bay order. */
export function stationsByBay(): { bay: BayDef; stations: StationDef[] }[] {
  return BAYS.map((bay) => ({
    bay,
    stations: STATIONS.filter((s) => s.bay === bay.id),
  }));
}

/** Live stations only (have an applet to open). */
export function liveStations(): StationDef[] {
  return STATIONS.filter((s) => s.appletId !== null);
}
