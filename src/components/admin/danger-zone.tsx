"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pill, Panel } from "@/components/admin/ui";
import { DeleteUserDialog } from "@/components/admin/delete-user-dialog";

/** Suspend / unsuspend / delete controls for a pilot. */
export function DangerZone({
  userId,
  email,
  suspended: initialSuspended,
}: {
  userId: string;
  email: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const [suspended, setSuspended] = useState(initialSuspended);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const post = async (kind: "suspend" | "unsuspend") => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const requestBody = kind === "suspend" ? { reason } : { note: reason };
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/${kind}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(requestBody),
        },
      );
      const responseBody = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(responseBody?.error ?? `HTTP ${res.status}`);
      setSuspended(kind === "suspend");
      setNotice(
        kind === "suspend"
          ? "Account suspended. The pilot cannot sign in."
          : "Account restored. The pilot can sign in again.",
      );
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Danger Zone" tone="red">
      <div className="flex flex-col gap-6">
        {error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-lg border border-green-400/30 bg-green-400/10 px-3 py-2 text-sm text-green-300">
            {notice}
          </p>
        )}

        {/* Suspend / unsuspend */}
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-star">Account status</h3>
            {suspended ? <Pill tone="red">Suspended</Pill> : <Pill tone="green">Active</Pill>}
          </div>
          <p className="mt-1 text-xs text-dim">
            A suspended pilot cannot sign in. The data stays intact.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (recorded in the audit log)…"
              aria-label="Reason for suspend or unsuspend"
              className="flex-1 rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-star placeholder:text-dim focus:border-amber-400/60 focus:outline-none"
            />
            {suspended ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => post("unsuspend")}
                className="rounded-lg border border-green-400/50 bg-green-400/10 px-4 py-2 text-sm font-semibold text-green-300 hover:bg-green-400/20 disabled:opacity-40"
              >
                {busy ? "Working…" : "Unsuspend"}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || reason.trim() === ""}
                onClick={() => post("suspend")}
                className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-400/20 disabled:opacity-40"
              >
                {busy ? "Working…" : "Suspend account"}
              </button>
            )}
          </div>
        </div>

        {/* Delete */}
        <div className="border-t border-white/10 pt-6">
          <h3 className="text-sm font-semibold text-star">Delete account</h3>
          <p className="mt-1 text-xs text-dim">
            Permanently removes the pilot and all related rows. A preview of
            everything that will be deleted is shown before anything happens.
          </p>
          <div className="mt-3">
            <DeleteUserDialog userId={userId} email={email} />
          </div>
        </div>
      </div>
    </Panel>
  );
}
