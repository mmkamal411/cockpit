/**
 * Weather provider — Open-Meteo (free, no key).
 *
 * Server-side fetch with 15-minute in-memory cache per rounded location.
 * Stale cache is served with its age rather than a blank card.
 */

export interface WeatherCurrent {
  temp: number;
  feelsLike: number;
  high: number;
  low: number;
  code: number;
  words: string;
  humidity: number;
  windMph: number;
  uvIndex: number;
  sunrise: string;
  sunset: string;
  updatedAt: number;
  stale: boolean;
  staleMinutes: number | null;
}

export interface HourlyPoint {
  time: string;
  temp: number;
  code: number;
  precipChance: number;
}

export interface DailyPoint {
  date: string;
  high: number;
  low: number;
  code: number;
  precipChance: number;
  sunrise: string;
  sunset: string;
}

export interface WeatherDetail extends WeatherCurrent {
  hourly: HourlyPoint[];
  daily: DailyPoint[];
}

export interface GeoResult {
  name: string;
  country: string | null;
  admin1: string | null;
  lat: number;
  lon: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const currentCache = new Map<string, CacheEntry<WeatherCurrent>>();
const detailCache = new Map<string, CacheEntry<WeatherDetail>>();

/** Round to ~0.1° (coarse per directive D7 — never precise GPS). */
export function roundCoord(n: number): number {
  return Math.round(n * 10) / 10;
}

function cacheKey(lat: number, lon: number, units: "F" | "C"): string {
  return `${roundCoord(lat)},${roundCoord(lon)},${units}`;
}

export function weatherWords(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  return "Stormy";
}

function plainSummary(d: WeatherDetail, units: "F" | "C"): string {
  const u = units === "F" ? "°F" : "°C";
  const rainyHours = d.hourly.filter((h) => h.precipChance >= 50).slice(0, 3);
  if (rainyHours.length > 0) {
    const first = new Date(rainyHours[0].time);
    const hr = first.toLocaleTimeString(undefined, { hour: "numeric" });
    return `Rain likely around ${hr} — grab the umbrella. High ${d.high}${u}.`;
  }
  if (d.high >= (units === "F" ? 90 : 32)) return `Hot one — high ${d.high}${u}. Stay cool out there.`;
  if (d.low <= (units === "F" ? 32 : 0)) return `Bundle up — low ${d.low}${u} tonight.`;
  return `${d.words}, high ${d.high}${u}. A fine day to be out.`;
}

async function fetchFromProvider(
  lat: number,
  lon: number,
  units: "F" | "C",
): Promise<WeatherDetail> {
  const tempUnit = units === "F" ? "fahrenheit" : "celsius";
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&hourly=temperature_2m,weather_code,precipitation_probability` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max` +
    `&temperature_unit=${tempUnit}&wind_speed_unit=mph&timezone=auto&forecast_days=7`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = await res.json();
  const now = Date.now();

  const hourly: HourlyPoint[] = (data.hourly?.time ?? [])
    .slice(0, 24)
    .map((t: string, i: number) => ({
      time: t,
      temp: Math.round(data.hourly.temperature_2m[i]),
      code: data.hourly.weather_code[i],
      precipChance: data.hourly.precipitation_probability?.[i] ?? 0,
    }));

  const daily: DailyPoint[] = (data.daily?.time ?? []).map((t: string, i: number) => ({
    date: t,
    high: Math.round(data.daily.temperature_2m_max[i]),
    low: Math.round(data.daily.temperature_2m_min[i]),
    code: data.daily.weather_code[i],
    precipChance: data.daily.precipitation_probability_max?.[i] ?? 0,
    sunrise: data.daily.sunrise[i],
    sunset: data.daily.sunset[i],
  }));

  const current: WeatherCurrent = {
    temp: Math.round(data.current.temperature_2m),
    feelsLike: Math.round(data.current.apparent_temperature),
    high: daily[0] ? daily[0].high : Math.round(data.current.temperature_2m),
    low: daily[0] ? daily[0].low : Math.round(data.current.temperature_2m),
    code: data.current.weather_code,
    words: weatherWords(data.current.weather_code),
    humidity: data.current.relative_humidity_2m,
    windMph: Math.round(data.current.wind_speed_10m),
    uvIndex: 0,
    sunrise: daily[0]?.sunrise ?? "",
    sunset: daily[0]?.sunset ?? "",
    updatedAt: now,
    stale: false,
    staleMinutes: null,
  };

  return { ...current, hourly, daily };
}

/** Current + today summary (glass-pane payload). Serves stale cache on failure. */
export async function getWeatherCurrent(
  lat: number,
  lon: number,
  units: "F" | "C" = "F",
): Promise<WeatherCurrent> {
  const key = cacheKey(lat, lon, units);
  const cached = currentCache.get(key);
  const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (fresh && cached) return cached.data;

  try {
    const detail = await fetchFromProvider(lat, lon, units);
    const current: WeatherCurrent = { ...detail };
    delete (current as Partial<WeatherDetail>).hourly;
    delete (current as Partial<WeatherDetail>).daily;
    currentCache.set(key, { data: current, fetchedAt: Date.now() });
    return current;
  } catch (err) {
    if (cached) {
      const staleMinutes = Math.round((Date.now() - cached.fetchedAt) / 60000);
      return { ...cached.data, stale: true, staleMinutes };
    }
    throw err;
  }
}

/** Full detail payload (applet). Serves stale cache on failure. */
export async function getWeatherDetail(
  lat: number,
  lon: number,
  units: "F" | "C" = "F",
): Promise<WeatherDetail & { summary: string }> {
  const key = cacheKey(lat, lon, units);
  const cached = detailCache.get(key);
  const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (fresh && cached) {
    return { ...cached.data, summary: plainSummary(cached.data, units) };
  }

  try {
    const detail = await fetchFromProvider(lat, lon, units);
    detailCache.set(key, { data: detail, fetchedAt: Date.now() });
    return { ...detail, summary: plainSummary(detail, units) };
  } catch (err) {
    if (cached) {
      const staleMinutes = Math.round((Date.now() - cached.fetchedAt) / 60000);
      const stale = { ...cached.data, stale: true, staleMinutes };
      return { ...stale, summary: plainSummary(stale, units) };
    }
    throw err;
  }
}

/** City/ZIP → coordinates via Open-Meteo geocoding. */
export async function searchLocation(q: string): Promise<GeoResult[]> {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`geocoding ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r: Record<string, unknown>) => ({
    name: r["name"] as string,
    country: (r["country"] as string) ?? null,
    admin1: (r["admin1"] as string) ?? null,
    lat: roundCoord(r["latitude"] as number),
    lon: roundCoord(r["longitude"] as number),
  }));
}
