import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { getOwnedCrewMemberId } from "@/lib/crew/member-access";
import {
  escapeHtmlText,
  extractPdfTextLayer,
  processUpload,
} from "@/lib/school-source-pipeline";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const UPLOAD_BUCKET = "school-source-uploads";

function logError(operation: string, error: unknown) {
  console.error(
    JSON.stringify({
      route: "api/crew/members/[id]/school-sources/upload",
      operation,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() || "upload";
  return base.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || "upload";
}

/**
 * POST /api/crew/members/[id]/school-sources/upload
 * Accept a photo or PDF of a school calendar / bell schedule page
 * (multipart form: file, kind='calendar'|'bell', label?).
 *
 * - Photos are stored and honestly marked "needs a human look" — image text
 *   reading isn't available, so we never claim a parse that didn't happen.
 * - PDFs with a text layer are read and parsed; PDFs without one are stored
 *   with the same honest note.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  const supabase = await createClient();
  const ownedId = await getOwnedCrewMemberId(supabase, crewMemberId, pilotId);
  if (!ownedId) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that upload. Try again." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "No file came through. Choose a photo or PDF and try again." },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "That file is bigger than 10 MB. Try a smaller photo or PDF." },
      { status: 400 },
    );
  }

  const mime = (file.type || "").toLowerCase();
  const isPdf = mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isPhoto = mime.startsWith("image/") && !isPdf;
  if (!isPdf && !isPhoto) {
    return NextResponse.json(
      { error: "That file type won't work here — please send a photo or a PDF." },
      { status: 400 },
    );
  }

  const pageKind = form.get("kind") === "bell" ? "bell" : "calendar";
  const rawLabel = form.get("label");
  const label =
    typeof rawLabel === "string" && rawLabel.trim()
      ? rawLabel.trim().slice(0, 120)
      : cleanFileName(file.name).replace(/\.[a-z0-9]+$/i, "") || "Uploaded page";

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that file. Try again." },
      { status: 400 },
    );
  }

  // Store the file: "<crew_member_id>/<uuid>-<name>" so the storage policy
  // can verify stewardship from the path itself.
  const ext = isPdf ? "pdf" : (mime.split("/")[1] || "jpg").split("+")[0];
  const storagePath = `${ownedId}/${crypto.randomUUID()}-${cleanFileName(file.name).replace(/\.[a-z0-9]+$/i, "")}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(storagePath, bytes, {
      contentType: isPdf ? "application/pdf" : mime || "image/jpeg",
      upsert: false,
    });
  if (uploadError) {
    logError("storage upload", uploadError);
    return NextResponse.json(
      { error: "We couldn't save that file. Try again." },
      { status: 500 },
    );
  }

  // PDFs: try the text layer, then parse what we find. Photos: store only.
  let contentHtml: string | null = null;
  if (isPdf) {
    const text = await extractPdfTextLayer(bytes);
    if (text) {
      contentHtml =
        `<div class="school-source-content"><pre>${escapeHtmlText(text)}</pre></div>`;
    }
  }

  try {
    const outcome = await processUpload({
      supabase,
      crewMemberId: ownedId,
      pageKind,
      label,
      storagePath,
      contentHtml,
      isPhoto,
    });
    return NextResponse.json({
      ok: true,
      kind: "upload",
      label,
      parsed: outcome.parsed,
      message: outcome.message,
    });
  } catch (err) {
    logError("process upload", err);
    // The file is stored; only the snapshot row failed. Say so plainly.
    return NextResponse.json(
      { error: "The file was saved, but we couldn't file it away. Try again." },
      { status: 500 },
    );
  }
}
