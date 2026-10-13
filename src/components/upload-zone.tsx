"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — same cap as Pookie
const BUCKET = "class-files";

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface UploadedFile {
  name: string;
  storagePath: string;
  size: number;
}

function validateFile(file: File): string | null {
  if (file.size > MAX_BYTES) {
    return `"${file.name}" is too big — the limit is 10 MB.`;
  }
  if (file.size === 0) {
    return `"${file.name}" looks empty — pick another file.`;
  }
  return null;
}

/**
 * UploadZone — neon drag-and-drop file upload for handouts and class files.
 * Uploads to the `class-files` bucket at
 * <crewMemberId>/<classSlug>/<yyyy-mm-dd>/<filename>. Graceful when the
 * bucket isn't set up yet: a plain-English note instead of a broken zone.
 */
export function UploadZone({
  memberId,
  className,
  unitTag,
  onUploaded,
}: {
  memberId: string;
  className: string;
  unitTag?: string | null;
  onUploaded: (file: UploadedFile) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [fileName, setFileName] = useState("");

  async function upload(file: File) {
    const problem = validateFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setFileName(file.name);
    setProgress(0);

    const day = new Date().toISOString().slice(0, 10);
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
    const path = `${memberId}/${slug(className)}/${day}/${Date.now()}-${cleanName}`;

    try {
      const supabase = createClient();
      // Fetch-based progress isn't exposed by storage-js; we show an
      // honest indeterminate state while the bytes fly.
      setProgress(0.5);
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      setProgress(1);
      onUploaded({ name: file.name, storagePath: path, size: file.size });
      setProgress(null);
      setFileName("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/bucket|not found|does not exist/i.test(msg)) {
        setUnavailable(true);
      } else {
        setError(
          `Couldn't upload "${file.name}". Check your connection and try again.`,
        );
      }
      setProgress(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  if (unavailable) {
    return (
      <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-4">
        <p className="text-sm text-star">File uploads aren&apos;t switched on yet</p>
        <p className="mt-1 text-xs leading-relaxed text-dim">
          The file storage for handouts is still being set up. Your links and
          notes below all work — try uploads again soon.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a handout or class file"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragging
            ? "border-neon-green/70 bg-neon-green/10"
            : "border-dim/40 bg-panel-2/40 hover:border-neon-green/40"
        }`}
      >
        <p className="text-2xl" aria-hidden="true">
          📎
        </p>
        <p className="mt-1 text-sm font-medium text-star">
          {progress !== null
            ? `Uploading ${fileName}…`
            : "Drop a handout here, or tap to choose"}
        </p>
        <p className="mt-0.5 text-xs text-dim">
          PDF, image, or document · up to 10 MB
          {unitTag ? ` · tagged to ${unitTag}` : ""}
        </p>
        {progress !== null && (
          <div
            className="mx-auto mt-3 h-1.5 w-3/4 overflow-hidden rounded-full bg-panel"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div
              className="h-full rounded-full bg-neon-green transition-all"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-neon-amber">
          {error}
        </p>
      )}
    </div>
  );
}
