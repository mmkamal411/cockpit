// Planetary vista sources — the opening-page hero layer.
//
// Four seamless-loop planetary vistas, one per daypart. The hero picks by
// local hour so the pilot walks into dawn / day / dusk / night skies.

export interface VistaSource {
  src: string;
  poster: string;
}

function vistaForHour(hour: number): VistaSource {
  if (hour >= 5 && hour < 11) {
    // Dawn — ringed gas giant past a viewport frame, teal nebula.
    return { src: "/videos/vista-planets-1.mp4", poster: "/videos/vista-planets-1-poster.jpg" };
  }
  if (hour >= 11 && hour < 17) {
    // Day — Earth-like blue world, atmosphere rim glow.
    return { src: "/videos/vista-planets-2.mp4", poster: "/videos/vista-planets-2-poster.jpg" };
  }
  if (hour >= 17 && hour < 21) {
    // Dusk — Earthrise over a cratered moon, teal nebula wisps.
    return { src: "/videos/vista-planets-3.mp4", poster: "/videos/vista-planets-3-poster.jpg" };
  }
  // Night — banded teal ice giant with aurora bands + small moon.
  return { src: "/videos/vista-planets-4.mp4", poster: "/videos/vista-planets-4-poster.jpg" };
}

/** Daypart vista for the given hour (0–23). Pure — safe to call anywhere. */
export function planetaryVista(hour: number): VistaSource {
  return vistaForHour(hour);
}

// ---------------------------------------------------------------------------
// Background rotation — the pilot is always moving through space.
//
// The shell background auto-rotates through these vistas so the journey
// never feels static. Order matters: vista-planets-1.mp4 is the original
// staging background and stays first.
//
// Videos not yet generated (vista-long-30s, vista-warp-deep-3,
// vista-ref-blue-3) are intentionally absent — add them here when ready.
// ---------------------------------------------------------------------------

export const ROTATION_VIDEOS: string[] = [
  "/videos/vista-planets-1.mp4", // original staging background — keep first
  "/videos/vista-warp-procedural.mp4", // mathematically seamless starfield warp
  "/videos/vista-warp-nebula-2.mp4", // warp + subtle nebula wisps
  "/videos/vista-nebula-blue-1.mp4", // arctic blue nebula flight
  "/videos/vista-nebula-blue-2.mp4", // dense star clusters, blue veils
  "/videos/vista-ref-blue-1.mp4", // deep blue, teal wisps (Meheldi's reference)
  "/videos/vista-ref-blue-2.mp4", // denser starfield variation
];

/** Rotation slot length in milliseconds. */
export const ROTATION_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Which rotation video should be showing right now. Deterministic from the
 * clock so it never drifts and resumes correctly after sleep.
 */
export function rotationVideo(nowMs: number = Date.now()): string {
  const slot = Math.floor(nowMs / ROTATION_INTERVAL_MS);
  return ROTATION_VIDEOS[slot % ROTATION_VIDEOS.length];
}

/** The video that comes after `src` in the rotation (for preloading). */
export function nextRotationVideo(src: string): string {
  const i = ROTATION_VIDEOS.indexOf(src);
  return ROTATION_VIDEOS[(i + 1) % ROTATION_VIDEOS.length];
}
