import { NextResponse } from "next/server";
import { searchLocation } from "@/lib/weather";

/**
 * GET /api/weather/search?q=
 * City/ZIP geocoding for the location picker.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json(
        { error: "q must be at least 2 characters" },
        { status: 400 },
      );
    }
    const results = await searchLocation(q);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { error: "Location search is unavailable right now." },
      { status: 502 },
    );
  }
}
