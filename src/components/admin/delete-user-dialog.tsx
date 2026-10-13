"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeletePreview } from "@/lib/admin/types";
import { Pill, SkeletonTable, EmptyState } from "@/components/admin/ui";

/**
 * DeleteUserDialog — two-step destructive confirmation.
 *
 * Step 1: cascade preview ("This will permanently delete: 1 pilot,
 * 2 crew members, …") from DELETE ?preview=true.
 * Step 2: the admin must type the pilot's exact email before DELETE
 * with { confirm: "<email>" } executes.
 */
export function DeleteUserDialog({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  const openDialog = () => {
    setOpen(true);
    setStep(1);
    setPreview(null);
    setError(null);
    setConfirmText("");
    setLoading(true);
  };

  // Fetch the cascade preview when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/admin/users/${encodeURIComponent(userId)}?preview=true`, {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        return body as DeletePreview;
      })
      .then((body) => {
        if (!cancelled) setPreview(body);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Preview failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, userId]);

  const doDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ confirm: email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setOpen(false);
      router.push("/admin/users");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={openDialog}
        className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
      >
        Delete account…
      </button>
    );
  }

  const entries = preview ? Object.entries(preview.would_delete ?? {}) : [];
  const matches = confirmText.trim().toLowerCase() === email.toLowerCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-red-500/40 bg-panel p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Pill tone="red">Danger</Pill>
            <h2 id="delete-dialog-title" className="text-base font-semibold text-star">
              Delete this pilot account
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close dialog"
            className="rounded p-1 text-dim hover:text-star focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
            {error}
          </p>
        )}

        {step === 1 && (
          <>
            <p className="mt-4 text-sm text-stardust">
              This will permanently delete the pilot{" "}
              <span className="font-mono text-star">{email}</span> and everything
              below. This cannot be undone.
            </p>
            <div className="mt-4">
              {loading ? (
                <SkeletonTable rows={5} cols={2} />
              ) : preview ? (
                entries.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-dim">
                        <th className="px-3 py-2">Table</th>
                        <th className="px-3 py-2 text-right">Rows</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {entries.map(([table, count]) => (
                        <tr key={table} className="text-stardust">
                          <td className="px-3 py-2 font-mono text-xs">{table}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-red-300">
                            {count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <EmptyState title="Nothing to delete" hint="The preview came back empty." />
                )
              ) : (
                <p className="py-4 text-center text-sm text-dim">
                  {error ? "Preview failed to load." : "Loading preview…"}
                </p>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-stardust hover:border-white/30"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading || !preview || !!error}
                onClick={() => setStep(2)}
                className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="mt-4 text-sm text-stardust">
              To confirm, type the pilot&apos;s email exactly:
            </p>
            <p className="mt-2 font-mono text-sm text-amber-300">{email}</p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type the email to confirm"
              aria-label="Type the pilot's email to confirm deletion"
              autoComplete="off"
              className="mt-3 w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 font-mono text-sm text-star placeholder:text-dim focus:border-red-400/60 focus:outline-none"
            />
            <div className="mt-6 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-stardust hover:border-white/30"
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={!matches || loading}
                onClick={doDelete}
                className="rounded-lg border border-red-500 bg-red-600/80 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-40"
              >
                {loading ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
