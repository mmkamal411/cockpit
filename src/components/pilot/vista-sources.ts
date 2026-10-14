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
// Each page load picks ONE video at random from the list below; that video
// then loops seamlessly until the next login/refresh. No timed switching.
//
// Order matters: vista-planets-1.mp4 is the original staging background and
// stays first. vista-warp-nebula-2.mp4 was removed per Meheldi (2026-10-13).
//
// Videos not yet generated (vista-long-30s, vista-warp-deep-3,
// vista-ref-blue-3) are intentionally absent — add them here when ready.
// ---------------------------------------------------------------------------

export const ROTATION_VIDEOS: string[] = [
  "/videos/vista-planets-1.mp4", // original staging background — keep first
  "/videos/vista-warp-procedural.mp4", // mathematically seamless starfield warp
  "/videos/vista-nebula-blue-1.mp4", // arctic blue nebula flight
  "/videos/vista-nebula-blue-2.mp4", // dense star clusters, blue veils
  "/videos/vista-ref-blue-1.mp4", // deep blue, teal wisps (Meheldi's reference)
  "/videos/vista-ref-blue-2.mp4", // denser starfield variation
  "/videos/vista-ref-blue-3.mp4", // dramatic nebula formations
];

/**
 * Pick one rotation video at random. Call once per page load and keep the
 * result for the session — the video only changes on the next login/refresh.
 */
export function pickRotationVideo(): string {
  const i = Math.floor(Math.random() * ROTATION_VIDEOS.length);
  return ROTATION_VIDEOS[i];
}
