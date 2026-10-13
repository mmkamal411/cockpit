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
