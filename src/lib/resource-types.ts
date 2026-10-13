/**
 * Resource visual identities — 13 types, each with its own color + icon + glow.
 * Ported from Pookie's resource-library (pookie-app). Never a plain link list:
 * every resource renders as a card in its platform identity.
 */

export type ResourceTypeId =
  | "khan"
  | "youtube"
  | "quizlet"
  | "kahoot"
  | "blooket"
  | "desmos"
  | "deltamath"
  | "apclassroom"
  | "clever"
  | "ebook"
  | "cheatsheet"
  | "game"
  | "other";

export interface ResourceType {
  id: ResourceTypeId;
  /** Platform label, plain words. */
  label: string;
  /** Neon accent hex for the card identity. */
  color: string;
  /** Icon glyph rendered on the card. */
  icon: string;
  /** Soft glow style for the card halo. */
  glow: string;
  /** URL-only, upload-only, or either — the upload-vs-URL picker rule. */
  input: "url" | "file" | "either";
}

export const RESOURCE_TYPES: ResourceType[] = [
  { id: "khan", label: "Khan Academy", color: "#22c55e", icon: "🌿", glow: "0 0 18px rgba(34,197,94,0.25)", input: "url" },
  { id: "youtube", label: "YouTube", color: "#ef4444", icon: "▶️", glow: "0 0 18px rgba(239,68,68,0.25)", input: "url" },
  { id: "quizlet", label: "Quizlet", color: "#3b82f6", icon: "🃏", glow: "0 0 18px rgba(59,130,246,0.25)", input: "url" },
  { id: "kahoot", label: "Kahoot", color: "#a855f7", icon: "🎯", glow: "0 0 18px rgba(168,85,247,0.25)", input: "url" },
  { id: "blooket", label: "Blooket", color: "#f59e0b", icon: "🧱", glow: "0 0 18px rgba(245,158,11,0.25)", input: "url" },
  { id: "desmos", label: "Desmos", color: "#22d3ee", icon: "📈", glow: "0 0 18px rgba(34,211,238,0.25)", input: "url" },
  { id: "deltamath", label: "DeltaMath", color: "#a3e635", icon: "∑", glow: "0 0 18px rgba(163,230,53,0.25)", input: "url" },
  { id: "apclassroom", label: "AP Classroom", color: "#818cf8", icon: "🎓", glow: "0 0 18px rgba(129,140,248,0.25)", input: "url" },
  { id: "clever", label: "Clever", color: "#2dd4bf", icon: "🔷", glow: "0 0 18px rgba(45,212,191,0.25)", input: "url" },
  { id: "ebook", label: "Ebook", color: "#c084fc", icon: "📖", glow: "0 0 18px rgba(192,132,252,0.25)", input: "either" },
  { id: "cheatsheet", label: "Cheat sheet", color: "#fbbf24", icon: "📝", glow: "0 0 18px rgba(251,191,36,0.25)", input: "either" },
  { id: "game", label: "Game", color: "#f472b6", icon: "🎮", glow: "0 0 18px rgba(244,114,182,0.25)", input: "url" },
  { id: "other", label: "Other link", color: "#94a3b8", icon: "🔗", glow: "0 0 18px rgba(148,163,184,0.2)", input: "either" },
];

export function resourceTypeFor(id: string): ResourceType {
  return (
    RESOURCE_TYPES.find((t) => t.id === id) ??
    RESOURCE_TYPES[RESOURCE_TYPES.length - 1]
  );
}

/** Upload-vs-URL picker options for the add-time two-option picker. */
export function inputOptionsFor(
  type: ResourceType,
): Array<{ id: "url" | "file"; label: string; hint: string }> {
  const url = { id: "url" as const, label: "Paste a link", hint: "A web address for this resource" };
  const file = { id: "file" as const, label: "Upload a file", hint: "PDF, image, or document up to 10 MB" };
  if (type.input === "url") return [url];
  if (type.input === "file") return [file];
  return [file, url];
}
