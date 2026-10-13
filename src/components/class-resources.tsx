"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  RESOURCE_TYPES,
  resourceTypeFor,
  inputOptionsFor,
} from "@/lib/resource-types";
import { UploadZone } from "@/components/upload-zone";

export interface ClassResource {
  id: string;
  class_name: string;
  unit_tag: string | null;
  kind: "file" | "link";
  title: string;
  resource_type: string;
  url: string | null;
  storage_path: string | null;
  added_by: "pilot" | "crew";
  used_count: number;
  helpful_count: number;
  created_at: string;
}

/**
 * ClassResources — the Learn & resources surface for one class.
 *
 * Two tabs, per the plan: Files (handout uploads, unit-tagged, searchable)
 * and Links (13 resource types as visual cards with color+icon+glow, never
 * a plain link list). Add-time uses the upload-vs-URL picker: handouts and
 * class files upload; Khan/YouTube/games are URL-only; ebooks/cheat sheets
 * get both. Parent uploads are visible; child uploads are private-by-default.
 * The usage loop ("used it" / "helpful" taps) feeds Path-to-90 and sinks stale
 * resources.
 */
export function ClassResources({
  memberId,
  className,
  currentUnit,
  viewerIsChild,
}: {
  memberId: string;
  className: string;
  currentUnit?: string | null;
  /** True when the viewer is the child (affects added_by + privacy copy). */
  viewerIsChild?: boolean;
}) {
  const [tab, setTab] = useState<"files" | "links">("files");
  const [resources, setResources] = useState<ClassResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const addedBy = viewerIsChild ? "crew" : "pilot";

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/crew/members/${memberId}/resources?class=${encodeURIComponent(className)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't load resources.");
      setResources((json.resources ?? []) as ClassResource[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load resources.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, className]);

  const files = useMemo(
    () => resources.filter((r) => r.kind === "file"),
    [resources],
  );
  const links = useMemo(
    () => resources.filter((r) => r.kind === "link"),
    [resources],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = tab === "files" ? files : links;
    if (!q) return pool;
    return pool.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.unit_tag ?? "").toLowerCase().includes(q),
    );
  }, [search, tab, files, links]);

  async function openFile(r: ClassResource) {
    if (!r.storage_path || signedUrls[r.id]) return;
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from("class-files")
        .createSignedUrl(r.storage_path, 3600);
      if (error || !data?.signedUrl) throw new Error();
      setSignedUrls((p) => ({ ...p, [r.id]: data.signedUrl }));
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError("Couldn't open that file right now. Try again.");
    }
  }

  async function removeResource(r: ClassResource) {
    if (!window.confirm(`Remove "${r.title}"?`)) return;
    try {
      const res = await fetch(
        `/api/crew/members/${memberId}/resources?id=${encodeURIComponent(r.id)}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't remove it.");
      // Delete the stored file too (best effort).
      if (json.storage_path) {
        try {
          await createClient()
            .storage.from("class-files")
            .remove([json.storage_path as string]);
        } catch {
          /* row is gone; file cleanup is best-effort */
        }
      }
      setResources((p) => p.filter((x) => x.id !== r.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it.");
    }
  }

  async function tap(r: ClassResource, which: "used" | "helpful") {
    try {
      const res = await fetch(`/api/crew/members/${memberId}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id, tap: which }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error();
      const key = which === "used" ? "used_count" : "helpful_count";
      setResources((p) =>
        p.map((x) => (x.id === r.id ? { ...x, [key]: json[key] } : x)),
      );
    } catch {
      /* taps are best-effort; the card stays usable */
    }
  }

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-2" role="tablist" aria-label="Class materials">
        {(
          [
            { id: "files", label: `Files · ${files.length}` },
            { id: "links", label: `Links · ${links.length}` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-neon-green/50 bg-neon-green/10 text-neon-green"
                : "border-line bg-panel-2/40 text-stardust hover:text-star"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-xs text-neon-amber">
          {error}
        </p>
      )}

      {loading ? (
        <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
          Gathering the materials…
        </p>
      ) : (
        <>
          {/* Search */}
          {(files.length > 0 || links.length > 0) && (
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${tab === "files" ? "files" : "links"}…`}
              aria-label={`Search ${tab}`}
              className="w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-star placeholder:text-dim/70 focus:border-neon-green/50 focus:outline-none"
            />
          )}

          {tab === "files" && (
            <div className="space-y-2">
              <UploadZone
                memberId={memberId}
                className={className}
                unitTag={currentUnit}
                onUploaded={async (f) => {
                  const res = await fetch(
                    `/api/crew/members/${memberId}/resources`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        class_name: className,
                        unit_tag: currentUnit ?? undefined,
                        kind: "file",
                        title: f.name,
                        resource_type: "other",
                        storage_path: f.storagePath,
                        added_by: addedBy,
                      }),
                    },
                  );
                  const json = await res.json();
                  if (res.ok && json.resource) {
                    setResources((p) => [json.resource, ...p]);
                  } else {
                    setError(
                      "The file uploaded, but we couldn't file it away. Try again.",
                    );
                  }
                }}
              />
              {visible.length === 0 ? (
                <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
                  {search
                    ? "No files match that search."
                    : "No handouts yet — drop the first one above and it's tagged to this class automatically."}
                </p>
              ) : (
                visible.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/60 px-4 py-2.5"
                  >
                    <span className="text-lg" aria-hidden="true">
                      📄
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-star">{r.title}</p>
                      <p className="text-xs text-dim">
                        {r.unit_tag ? `${r.unit_tag} · ` : ""}
                        {r.added_by === "crew" ? "Added by you · private" : "Added by parent"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openFile(r)}
                      className="shrink-0 rounded-lg border border-neon-green/40 px-2.5 py-1 text-xs font-medium text-neon-green hover:bg-neon-green/10"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeResource(r)}
                      aria-label={`Remove ${r.title}`}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs text-dim hover:text-star"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "links" && (
            <div className="space-y-2">
              {visible.length === 0 ? (
                <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
                  {search
                    ? "No links match that search."
                    : "No saved links yet — add a Khan video, a cheat sheet, anything that helps. They live here, organized by unit."}
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {visible.map((r) => {
                    const type = resourceTypeFor(r.resource_type);
                    return (
                      <div
                        key={r.id}
                        className="rounded-xl border border-line bg-panel-2/60 px-4 py-3"
                        style={{ boxShadow: type.glow }}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
                            style={{ background: `${type.color}22`, border: `1px solid ${type.color}55` }}
                            aria-hidden="true"
                          >
                            {type.icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <a
                              href={r.url ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block truncate text-sm font-medium text-star hover:underline"
                            >
                              {r.title}
                            </a>
                            <p className="mt-0.5 text-xs" style={{ color: type.color }}>
                              {type.label}
                              {r.unit_tag ? (
                                <span className="text-dim"> · {r.unit_tag}</span>
                              ) : null}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void removeResource(r)}
                            aria-label={`Remove ${r.title}`}
                            className="shrink-0 rounded-lg px-2 py-1 text-xs text-dim hover:text-star"
                          >
                            ✕
                          </button>
                        </div>
                        {/* Usage loop: "used it / helpful" taps */}
                        <div className="mt-2 flex items-center gap-2 pl-12">
                          <button
                            type="button"
                            onClick={() => void tap(r, "used")}
                            className="rounded-full border border-line px-2.5 py-1 text-[11px] text-stardust hover:border-neon-green/40 hover:text-star"
                          >
                            ✓ Used it{r.used_count > 0 ? ` · ${r.used_count}` : ""}
                          </button>
                          <button
                            type="button"
                            onClick={() => void tap(r, "helpful")}
                            className="rounded-full border border-line px-2.5 py-1 text-[11px] text-stardust hover:border-neon-green/40 hover:text-star"
                          >
                            👍 Helpful{r.helpful_count > 0 ? ` · ${r.helpful_count}` : ""}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Add flow */}
          {adding ? (
            <AddResourceForm
              memberId={memberId}
              className={className}
              currentUnit={currentUnit}
              addedBy={addedBy}
              onDone={(r) => {
                if (r) setResources((p) => [r, ...p]);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full rounded-xl border border-dashed border-dim/40 bg-panel-2/40 px-4 py-2.5 text-sm font-medium text-stardust transition-colors hover:border-neon-green/40 hover:text-star"
            >
              + Add a resource
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Add-resource form with the upload-vs-URL picker at add time:
 * [📎 Upload a file] [🔗 Paste a link] — per type rules
 * (Khan/YouTube/games = URL only; ebooks/cheat sheets = either).
 */
function AddResourceForm({
  memberId,
  className,
  currentUnit,
  addedBy,
  onDone,
  onCancel,
}: {
  memberId: string;
  className: string;
  currentUnit?: string | null;
  addedBy: "pilot" | "crew";
  onDone: (r: ClassResource | null) => void;
  onCancel: () => void;
}) {
  const [typeId, setTypeId] = useState<string>("khan");
  const [title, setTitle] = useState("");
  const [unitTag, setUnitTag] = useState(currentUnit ?? "");
  const [url, setUrl] = useState("");
  const [inputKind, setInputKind] = useState<"url" | "file">("url");
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const type = resourceTypeFor(typeId);
  const options = inputOptionsFor(type);

  async function save() {
    if (saving) return;
    if (!title.trim()) {
      setError("Give it a title so it's easy to find later.");
      return;
    }
    if (inputKind === "url") {
      try {
        const p = new URL(url.trim());
        if (p.protocol !== "http:" && p.protocol !== "https:") throw new Error();
      } catch {
        setError("That link doesn't look like a web address — check it and try again.");
        return;
      }
    } else if (!uploadedPath) {
      setError("Upload the file first, then save.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/crew/members/${memberId}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_name: className,
          unit_tag: unitTag.trim() || undefined,
          kind: inputKind,
          title: title.trim(),
          resource_type: typeId,
          url: inputKind === "url" ? url.trim() : undefined,
          storage_path: inputKind === "file" ? uploadedPath : undefined,
          added_by: addedBy,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't save it.");
      onDone(json.resource as ClassResource);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save it. Try again.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-neon-green/30 bg-panel-2/60 px-4 py-4">
      <p className="text-sm font-medium text-star">Add a resource</p>

      {/* Type picker */}
      <div>
        <span className="text-xs font-medium text-dim">What kind is it?</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {RESOURCE_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTypeId(t.id);
                setInputKind(inputOptionsFor(t)[0].id);
              }}
              aria-pressed={typeId === t.id}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                typeId === t.id
                  ? "font-semibold text-star"
                  : "border-line text-stardust hover:text-star"
              }`}
              style={
                typeId === t.id
                  ? { borderColor: `${t.color}88`, background: `${t.color}18` }
                  : undefined
              }
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Upload-vs-URL picker */}
      {options.length > 1 && (
        <div className="flex gap-2" role="radiogroup" aria-label="How to add it">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={inputKind === o.id}
              onClick={() => setInputKind(o.id)}
              className={`flex-1 rounded-xl border px-3 py-2 text-left transition-colors ${
                inputKind === o.id
                  ? "border-neon-green/50 bg-neon-green/10"
                  : "border-line hover:border-dim/60"
              }`}
            >
              <span className="block text-xs font-semibold text-star">
                {o.id === "file" ? "📎 " : "🔗 "}
                {o.label}
              </span>
              <span className="block text-[11px] text-dim">{o.hint}</span>
            </button>
          ))}
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-dim" htmlFor="res-title">
          Title
        </label>
        <input
          id="res-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Proofs practice set"
          className="mt-1 w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-star placeholder:text-dim/70 focus:border-neon-green/50 focus:outline-none"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-dim" htmlFor="res-unit">
          Unit tag <span className="font-normal">(defaults to the current unit)</span>
        </label>
        <input
          id="res-unit"
          value={unitTag}
          onChange={(e) => setUnitTag(e.target.value)}
          placeholder="e.g. Unit 4 — Proofs"
          className="mt-1 w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-star placeholder:text-dim/70 focus:border-neon-green/50 focus:outline-none"
        />
      </div>

      {inputKind === "url" ? (
        <div>
          <label className="text-xs font-medium text-dim" htmlFor="res-url">
            Link
          </label>
          <input
            id="res-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            inputMode="url"
            className="mt-1 w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-star placeholder:text-dim/70 focus:border-neon-green/50 focus:outline-none"
          />
        </div>
      ) : (
        <UploadZone
          memberId={memberId}
          className={className}
          unitTag={unitTag || currentUnit}
          onUploaded={(f) => {
            setUploadedPath(f.storagePath);
            if (!title) setTitle(f.name);
          }}
        />
      )}

      {error && (
        <p role="alert" className="text-xs text-neon-amber">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-line px-4 py-2 text-sm text-stardust hover:text-star"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex-1 rounded-xl border border-neon-green/50 bg-neon-green/15 px-4 py-2 text-sm font-semibold text-neon-green hover:bg-neon-green/25 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save resource"}
        </button>
      </div>
    </div>
  );
}
