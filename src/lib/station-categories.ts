import type { AppletParams } from "./applet-bus";

export interface StationSubcategory {
  id: string;
  /** Plain-English label (grandmother test — no jargon). */
  label: string;
  /** One calm line about what lives here. */
  blurb: string;
  /** Target applet id, or null when the module isn't built yet. */
  appletId: string | null;
  params?: AppletParams;
  /** Only rendered when the pilot has ≥1 linked child. Lets the parent
      category stay visible (so the add-child path is reachable) while
      child-specific entries stay hidden for childless pilots. */
  childrenOnly?: boolean;
  /** Honest "why not yet" copy for null-applet entries — never blank. */
  soonNote?: string;
}

export interface StationCategory {
  id: string;
  label: string;
  /** Neon glow for the button instrument. */
  glow: string;
  /** Only rendered when the pilot has ≥1 linked child (user-first rule). */
  childrenOnly?: boolean;
  subcategories: StationSubcategory[];
}

/**
 * The six home-station categories (plan §2.1). Subcategories whose applet
 * doesn't exist yet keep `appletId: null` and show an honest "coming soon"
 * panel — the full ship stays visible from the first tap.
 */
export const STATION_CATEGORIES: StationCategory[] = [
  {
    id: "my-day",
    label: "My Day",
    glow: "#67e8f9",
    subcategories: [
      { id: "briefing", label: "Today's briefing", blurb: "Your attention, right now.", appletId: "today" },
      { id: "calendar", label: "Calendar", blurb: "Meetings, events, and what's next.", appletId: "calendar" },
      { id: "tasks", label: "Tasks & to-dos", blurb: "The list that keeps you honest.", appletId: "today" },
      { id: "nudges", label: "Nudges", blurb: "Gentle reminders from your cockpit.", appletId: "nudges" },
      { id: "weather", label: "Weather", blurb: "The skies above your home port.", appletId: "weather" },
    ],
  },
  {
    id: "home-money",
    label: "Home & Money",
    glow: "#fcd34d",
    subcategories: [
      { id: "bills", label: "Bills", blurb: "What's due, what's paid, what's leaking.", appletId: "bills" },
      { id: "subscriptions", label: "Subscriptions", blurb: "Every recurring charge, in one place.", appletId: "subscriptions" },
      {
        id: "spending",
        label: "Spending",
        blurb: "Where the money actually went.",
        appletId: null,
        soonNote: "Spending insights are being built — your purchase history will organize itself here.",
      },
      { id: "shopping", label: "Shopping lists", blurb: "Lists that notice when you're running low.", appletId: "shopping" },
      {
        id: "properties",
        label: "Properties",
        blurb: "Your places and their pulse.",
        appletId: null,
        soonNote: "Property tracking is on the way — one calm view of your places.",
      },
    ],
  },
  {
    id: "go-explore",
    label: "Go & Explore",
    glow: "#c4b5fd",
    subcategories: [
      {
        id: "flights",
        label: "Flights",
        blurb: "Your trips through the sky.",
        appletId: null,
        soonNote: "Flight tracking is being built — your itineraries will land here.",
      },
      {
        id: "trips",
        label: "Trips",
        blurb: "Adventures, planned and dreaming.",
        appletId: null,
        soonNote: "Trip planning is on the way — itineraries, stays, and packing in one place.",
      },
      {
        id: "fuel",
        label: "Gas & EV charging",
        blurb: "The cheapest fill-up nearby.",
        appletId: null,
        soonNote: "We're wiring fuel prices up — the cheapest nearby fill-up or charge will show here.",
      },
      {
        id: "deals",
        label: "Vacation deals",
        blurb: "Getaways worth taking.",
        appletId: null,
        soonNote: "Vacation deals are coming — hand-picked getaways will appear here.",
      },
    ],
  },
  {
    id: "family-school",
    label: "Family & School",
    glow: "#86efac",
    // NOTE: the category itself is NEVER childrenOnly — it holds the only
    // add-a-child path (Family settings → Crew applet). Hiding it until a
    // child exists makes the first child un-addable (catch-22, 2026-10-13).
    // Child-specific entries are gated individually below instead.
    subcategories: [
      { id: "school-station", label: "School station", blurb: "Grades, today's mission, and school life.", appletId: "school", childrenOnly: true },
      { id: "family", label: "Family settings", blurb: "Your crew, school logins, and sync.", appletId: "crew" },
      {
        id: "sharing",
        label: "Sharing & grants",
        blurb: "Who can see whose school life.",
        appletId: null,
        soonNote: "The Sharing screen arrives with the next build — who can see what, and your say over it, will live here. You can already manage your crew under Family settings.",
      },
      { id: "sync", label: "Sync", blurb: "School connections and last-synced times.", appletId: "crew", childrenOnly: true },
    ],
  },
  {
    id: "health-habits",
    label: "Health & Habits",
    glow: "#f9a8d4",
    subcategories: [
      { id: "metrics", label: "Health metrics", blurb: "The numbers that matter.", appletId: "health" },
      { id: "steps", label: "Steps", blurb: "Movement, day by day.", appletId: "health" },
      { id: "sleep", label: "Sleep", blurb: "Rest, tracked gently.", appletId: "health" },
      {
        id: "meals",
        label: "Meals",
        blurb: "What's fueling the ship.",
        appletId: null,
        soonNote: "Meal tracking is being built — food and fuel will live here.",
      },
      { id: "workouts", label: "Workouts", blurb: "Sweat, logged calmly.", appletId: "health" },
    ],
  },
  {
    id: "messages-mail",
    label: "Messages & Mail",
    glow: "#a5b4fc",
    subcategories: [
      {
        id: "inbox",
        label: "Inbox",
        blurb: "Email, triaged — the important stuff floats up.",
        appletId: null,
        soonNote: "Your unified inbox is being wired up — every account, one calm triage.",
      },
      {
        id: "teacher-comms",
        label: "Teacher messages",
        blurb: "School mail and replies awaiting your OK.",
        appletId: null,
        soonNote: "Teacher messages land with the next school upgrade — threads and draft approvals will live here.",
      },
      {
        id: "physical-mail",
        label: "Physical mail",
        blurb: "Snap a letter — it gets logged with action items.",
        appletId: null,
        soonNote: "Photo mail intake is coming — snap a letter and we'll log what it asks of you.",
      },
      {
        id: "support",
        label: "Support",
        blurb: "Help center, AI help, and tickets.",
        appletId: null,
        soonNote: "Support is being built — the help center and your tickets will live here.",
      },
    ],
  },
];

export function getCategory(id: string | undefined): StationCategory | undefined {
  return STATION_CATEGORIES.find((c) => c.id === id);
}
