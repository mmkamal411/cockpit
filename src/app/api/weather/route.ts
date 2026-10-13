import { NextResponse } from "next/server";
import { getWeatherCurrent } from "@/lib/weather";

/**
 * GET /api/weather?lat=&lon=&units=
 * Current + today summary (glass-pane payload). 15-min server cache.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lon = Number(searchParams.get("lon"));
    const units = searchParams.get("units") === "C" ? "C" : "F";
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json(
        { error: "lat and lon query params are required" },
        { status: 400 },
      );
    }
    const current = await getWeatherCurrent(lat, lon, units);
    return NextResponse.json(current, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return NextResponse.json(
      { error: "The skies are quiet — weather is unavailable right now." },
      { status: 502 },
    );
  }
}
