/**
 * Pilot settings — one source of truth for the 7 settings panels.
 *
 * Storage: public.pilot_settings, one row per (pilot_id, namespace).
 * Namespaces map 1:1 to the settings panels:
 *   profile | connections | alerts | crystal | cockpit | family | privacy
 *
 * Profile basics (name, timezone, home location, temperature units) also live
 * on the pilots row (display_name, timezone, home_location, weather_units) —
 * the /api/settings/profile route bridges the two.
 */

export type SettingsNamespace =
  | "profile"
  | "connections"
  | "alerts"
  | "crystal"
  | "cockpit"
  | "family"
  | "privacy";

export const SETTINGS_NAMESPACES: SettingsNamespace[] = [
  "profile",
  "connections",
  "alerts",
  "crystal",
  "cockpit",
  "family",
  "privacy",
];

// ---------------------------------------------------------------------------
// Shapes & defaults
// ---------------------------------------------------------------------------

export interface ProfileSettings {
  /** Data-URL (128px, downscaled in the browser) or remote URL. */
  avatar_url: string | null;
}

export interface ConnectionsSettings {
  /** Not wired to any backend yet — reserved for future per-kind prefs. */
  [key: string]: unknown;
}

export type ProactiveHelp = "off" | "gentle" | "eager";

export interface AlertSettings {
  /** Master switch for each attention domain. */
  domains: { school: boolean; money: boolean; health: boolean; home: boolean; travel: boolean };
  /** Grade-drop alert: warn when a class average falls below this. Default 90. */
  grade_drop_threshold: number;
  grade_alerts_enabled: boolean;
  /** Warn about upcoming due dates this far ahead (hours). */
  due_soon_hours: number;
  due_soon_enabled: boolean;
  /** Once-daily digest at a fixed time. */
  daily_reminder: boolean;
  daily_reminder_time: string; // "HH:MM"
  quiet_hours: { enabled: boolean; start: string; end: string };
  /** Even during quiet hours, break through for truly urgent items. Off by default. */
  urgent_breakthrough: boolean;
  /** 0–100: how eagerly alerts surface borderline items. */
  sensitivity: number;
}

export interface CrystalSettings {
  /** How proactively Crystal reaches out. Off / gentle nudges / eager. */
  proactive_help: ProactiveHelp;
  /** Let Crystal quietly improve from corrections ("no, that's wrong"). */
  learn_from_corrections: boolean;
}

export type OrbBehavior = "calm" | "lively";
export type NeonAccent = "teal" | "green" | "cyan" | "amber" | "purple";

export interface CockpitSettings {
  /** Ordered home-station ids (the More deck order). */
  home_stations: string[];
  /** Hero widgets pinned on the opening view. */
  hero_widgets: string[];
  neon_accent: NeonAccent;
  reduce_motion: boolean;
  celebrations: boolean;
  orb_behavior: OrbBehavior;
}

export interface FamilySettings {
  /** D1 (locked): check-ins are visible to the parent by default. */
  checkin_shared_by_default: boolean;
  /** D3 (locked): for 13–15, the parent sees the FULL check-in text. */
  full_checkin_text_13_15: boolean;
}

export interface PrivacySettings {
  /** How long personal data is kept, in days. 0 = keep forever. */
  retention_days: number;
  cookies: "essential" | "all";
}

export interface AllSettings {
  profile: ProfileSettings;
  connections: ConnectionsSettings;
  alerts: AlertSettings;
  crystal: CrystalSettings;
  cockpit: CockpitSettings;
  family: FamilySettings;
  privacy: PrivacySettings;
}

export const DEFAULT_SETTINGS: AllSettings = {
  profile: { avatar_url: null },
  connections: {},
  alerts: {
    domains: { school: true, money: true, health: true, home: true, travel: false },
    grade_drop_threshold: 90,
    grade_alerts_enabled: true,
    due_soon_hours: 24,
    due_soon_enabled: true,
    daily_reminder: false,
    daily_reminder_time: "08:00",
    quiet_hours: { enabled: true, start: "22:00", end: "07:00" },
    urgent_breakthrough: false,
    sensitivity: 50,
  },
  crystal: {
    proactive_help: "gentle",
    learn_from_corrections: true,
  },
  cockpit: {
    home_stations: ["today", "crystal", "progress", "health", "money", "mail", "shopping", "travel", "learn", "crew"],
    hero_widgets: ["weather", "calendar", "todos"],
    neon_accent: "teal",
    reduce_motion: false,
    celebrations: true,
    orb_behavior: "calm",
  },
  family: {
    // Meheldi's locked decisions: D1 shared by default, D3 full text for 13–15.
    checkin_shared_by_default: true,
    full_checkin_text_13_15: true,
  },
  privacy: {
    retention_days: 365,
    cookies: "essential",
  },
};

/** Plain-English descriptions for every setting — the grandmother test. */
export const SETTING_BLURBS: Record<string, string> = {
  grade_alerts_enabled: "Crystal watches class averages and taps you on the shoulder when one slides below your target.",
  grade_drop_threshold: "The number your class average has to stay above. Drop below this and you'll hear about it.",
  domains: "Pick which parts of your life are allowed to nudge you. Travel stays quiet unless you turn it on.",
  due_soon_hours: "How far ahead Crystal warns you about something coming due.",
  due_soon_enabled: "Turns the coming-due warnings on or off.",
  daily_reminder: "One calm recap each morning, at the time you choose.",
  daily_reminder_time: "The time your daily recap arrives.",
  quiet_hours: "Cockpit stays silent during these hours. Nothing buzzes you at night.",
  urgent_breakthrough: "Even in quiet hours, truly urgent things (a missed flight, a bill due today) can break through. Off by default.",
  sensitivity: "How eager alerts are. Low means only the sure things; high means Crystal mentions the maybes too.",
  proactive_help: "Off: Crystal only answers when you ask. Gentle: occasional helpful nudges. Eager: Crystal brings things up before you ask.",
  learn_from_corrections: "When you correct Crystal, it's allowed to quietly get better at that thing next time.",
  home_stations: "Drag your home stations into the order you want them. What you open most should sit on top.",
  hero_widgets: "The small cards pinned to your opening view — pick the ones you glance at every day.",
  neon_accent: "The neon glow color used across your cockpit. Purely cosmetic, entirely yours.",
  reduce_motion: "Calms the animations down — videos and drifts become gentle fades. Easier on the eyes and the battery.",
  celebrations: "Little moments of delight when good things happen — confetti when a goal lands, that sort of thing.",
  orb_behavior: "Calm: Crystal drifts slowly and settles. Lively: Crystal moves around more and reacts to what you do.",
  checkin_shared_by_default: "New check-ins are visible to you as the parent by default. Your child can still mark any single entry 'just for me.'",
  full_checkin_text_13_15: "For ages 13–15, you see the full check-in text — not just a summary. This is the locked family rule.",
  retention_days: "How long we keep your personal data. After that it is deleted for good.",
  cookies: "Essential: only what the site needs to work. All: also lets us remember little conveniences.",
  avatar_url: "Your photo, shown on the toolbar and your opening view.",
};

// ---------------------------------------------------------------------------
// Merge + validation (shared by the API route and the client optimistic UI)
// ---------------------------------------------------------------------------

type PlainObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge a partial update over defaults. Arrays replace wholesale
 * (order matters for home_stations); unknown keys are dropped so a bad
 * client can never poison the store.
 */
export function mergeSettings<T extends PlainObject>(defaults: T, patch: unknown): T {
  if (!isPlainObject(patch)) return defaults;
  const out: PlainObject = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const defVal = (defaults as PlainObject)[key];
    const patchVal = patch[key];
    if (patchVal === undefined) continue;
    if (isPlainObject(defVal) && isPlainObject(patchVal)) {
      out[key] = mergeSettings(defVal, patchVal);
    } else if (Array.isArray(defVal) && Array.isArray(patchVal)) {
      out[key] = patchVal;
    } else if (typeof defVal === typeof patchVal) {
      out[key] = patchVal;
    }
    // Type mismatches and unknown keys are silently dropped.
  }
  return out as T;
}

/** Clamp the numeric fields that have real bounds. */
export function sanitizeNamespace(ns: SettingsNamespace, value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  if (ns === "alerts") {
    const v = value as PlainObject;
    const out = { ...v };
    if (typeof out.grade_drop_threshold === "number") {
      out.grade_drop_threshold = Math.min(100, Math.max(0, Math.round(out.grade_drop_threshold)));
    }
    if (typeof out.sensitivity === "number") {
      out.sensitivity = Math.min(100, Math.max(0, Math.round(out.sensitivity)));
    }
    if (typeof out.due_soon_hours === "number") {
      out.due_soon_hours = Math.min(168, Math.max(1, Math.round(out.due_soon_hours)));
    }
    return out;
  }
  if (ns === "privacy") {
    const v = value as PlainObject;
    const out = { ...v };
    if (typeof out.retention_days === "number") {
      out.retention_days = Math.max(0, Math.round(out.retention_days));
    }
    return out;
  }
  return value;
}

/** Freshness label — "last synced 3h ago", matching the rest of the ship. */
export function freshnessLabel(iso: string | null | undefined): string {
  if (!iso) return "never synced";
  const ageMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ageMs)) return "never synced";
  const mins = Math.max(0, Math.round(ageMs / 60000));
  if (mins < 1) return "synced just now";
  if (mins < 60) return `synced ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `synced ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `synced ${days}d ago`;
}
