"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppletParams } from "@/lib/applet-bus";

interface ShoppingList {
  id: string;
  name: string;
  icon: string;
  unchecked_count: number;
  shared?: boolean;
  shared_by?: string;
  permission?: "view" | "edit";
}

interface ShoppingItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  checked: boolean;
  recurring: boolean;
  recurring_interval_days: number | null;
  notes: string | null;
  position: number;
}

interface ShareRow {
  id: string;
  email: string;
  permission: "view" | "edit";
  accepted: boolean;
  created_at: string;
}

const SEED_LISTS = [
  { name: "Groceries", icon: "🛒" },
  { name: "Household", icon: "🧹" },
  { name: "Pharmacy", icon: "💊" },
];

/** Shopping — smart lists with big one-hand check targets. Lists can be shared. */
export function ShoppingApplet({ params }: { params?: AppletParams }) {
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [inStore, setInStore] = useState(false);
  const [busy, setBusy] = useState(false);
  // Sharing
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [sharePerm, setSharePerm] = useState<"view" | "edit">("view");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSent, setShareSent] = useState<string | null>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(params?.welcome === "1");
  // Deep-link target (e.g. from an invite) — captured once at mount.
  const [deepLinkList] = useState<string | null>(params?.list ?? null);

  const loadLists = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/shopping/lists", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Your lists didn't load. Try again.",
        );
      }
      let next: ShoppingList[] = body.lists ?? [];
      // First open: seed the three starter lists (own lists only — a brand-new
      // pilot has no shares yet, so an empty response always means "new").
      if (next.length === 0) {
        const seeded: ShoppingList[] = [];
        for (const s of SEED_LISTS) {
          const r = await fetch("/api/shopping/lists", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(s),
          });
          const b = await r.json().catch(() => ({}));
          if (r.ok && b.list) seeded.push(b.list);
        }
        next = seeded;
      }
      setLists(next);
      setActiveId((prev) => {
        if (prev && next.some((l) => l.id === prev)) return prev;
        if (deepLinkList && next.some((l) => l.id === deepLinkList)) return deepLinkList;
        return next[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your lists didn't load. Try again.");
    } finally {
      setLoading(false);
    }
  }, [deepLinkList]);

  const loadItems = useCallback(async (listId: string) => {
    try {
      const res = await fetch(`/api/shopping/lists/${listId}/items`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "The items didn't load. Try again.",
        );
      }
      setItems(body.items ?? []);
    } catch {
      // Keep the lists visible; item errors show inline.
      setItems([]);
    }
  }, []);

  const loadShares = useCallback(async (listId: string) => {
    setSharesLoading(true);
    try {
      const res = await fetch(`/api/shopping/lists/${listId}/shares`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setShares(body.shares ?? []);
    } catch {
      setShares([]);
    } finally {
      setSharesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (activeId) loadItems(activeId);
  }, [activeId, loadItems]);

  // Load the share roster whenever the share dialog opens for the active list.
  useEffect(() => {
    if (shareOpen && activeId) {
      setShareError(null);
      setShareSent(null);
      loadShares(activeId);
    }
  }, [shareOpen, activeId, loadShares]);

  const activeList = lists.find((l) => l.id === activeId) ?? null;
  const isSharedList = activeList?.shared === true;
  const canEdit = !isSharedList || activeList?.permission !== "view";

  async function addItem() {
    const name = draft.trim();
    if (!name || !activeId || busy || !canEdit) return;
    setBusy(true);
    setDraft("");
    try {
      const res = await fetch(`/api/shopping/lists/${activeId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : "Couldn't add that item.");
      }
      setItems((prev) => [...prev, body.item]);
      setLists((prev) =>
        prev.map((l) => (l.id === activeId ? { ...l, unchecked_count: l.unchecked_count + 1 } : l)),
      );
    } catch (err) {
      setDraft(name);
      setError(err instanceof Error ? err.message : "Couldn't add that item.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCheck(item: ShoppingItem) {
    if (!canEdit) return;
    // Optimistic: flip immediately, reconcile with the server.
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)));
    try {
      const res = await fetch(`/api/shopping/items/${item.id}/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checked: !item.checked }),
      });
      if (!res.ok) throw new Error("check failed");
      setLists((prev) =>
        prev.map((l) =>
          l.id === activeId
            ? { ...l, unchecked_count: Math.max(0, l.unchecked_count + (item.checked ? 1 : -1)) }
            : l,
        ),
      );
    } catch {
      // Revert on failure.
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: item.checked } : i)));
    }
  }

  async function deleteItem(item: ShoppingItem) {
    if (!canEdit) return;
    if (!window.confirm(`Remove "${item.name}" from the list?`)) return;
    // Optimistic: remove immediately, revert on failure.
    const snapshot = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      const res = await fetch(`/api/shopping/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setLists((prev) =>
        prev.map((l) =>
          l.id === activeId
            ? { ...l, unchecked_count: Math.max(0, l.unchecked_count - (item.checked ? 0 : 1)) }
            : l,
        ),
      );
    } catch {
      setItems(snapshot);
      setError("Couldn't remove that item. Try again.");
    }
  }

  async function sendInvite() {
    const email = shareEmail.trim();
    if (!email || !activeId || shareBusy) return;
    setShareBusy(true);
    setShareError(null);
    setShareSent(null);
    try {
      const res = await fetch(`/api/shopping/lists/${activeId}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, permission: sharePerm }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : "Couldn't send the invite.");
      }
      setShareSent(
        body.inviteUrl
          ? `Invite sent to ${email}. You can also share this link directly: ${body.inviteUrl}`
          : `Invite sent to ${email}.`,
      );
      setShareEmail("");
      await loadShares(activeId);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Couldn't send the invite.");
    } finally {
      setShareBusy(false);
    }
  }

  async function revokeShare(shareId: string) {
    try {
      const res = await fetch(`/api/shopping/shares/${shareId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("revoke failed");
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch {
      setShareError("Couldn't remove that share. Try again.");
    }
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);
  const ownLists = lists.filter((l) => !l.shared);
  const sharedLists = lists.filter((l) => l.shared);

  return (
    <div className={`space-y-5 ${inStore ? "text-lg" : ""}`}>
      {showWelcome && activeList?.shared && (
        <div className="rounded-2xl border border-neon-green/40 bg-neon-green/10 p-4">
          <p className="text-sm font-medium text-star">
            🎉 {activeList.shared_by} shared &ldquo;{activeList.name}&rdquo; with you — welcome!
          </p>
          <p className="mt-1 text-xs leading-relaxed text-stardust">
            {activeList.permission === "edit"
              ? "You can add items and check things off together — changes show up for both of you."
              : "You can follow along as it updates."}{" "}
            Take a look around Cockpit whenever you like.
          </p>
          <button
            type="button"
            onClick={() => setShowWelcome(false)}
            className="mt-2 text-xs text-dim underline-offset-2 hover:text-star hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">Shopping</p>
          <h2 className="mt-1 text-xl font-semibold text-star">Your lists</h2>
          <p className="mt-1 text-sm text-stardust">
            Type it, tap it, done. Crystal will start noticing what you buy often.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInStore((v) => !v)}
          aria-pressed={inStore}
          className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
            inStore
              ? "border-neon-green/60 bg-neon-green/15 text-neon-green"
              : "border-line bg-panel-2/60 text-stardust hover:border-neon-green/40"
          }`}
        >
          {inStore ? "In-store: on" : "In-store mode"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-line bg-panel-2/60 p-4 text-center">
          <p className="text-sm text-stardust">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              loadLists();
            }}
            className="mt-2 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
          >
            Try again
          </button>
        </div>
      )}

      {/* List switcher */}
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Shopping lists">
        {loading ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="h-10 w-28 shrink-0 animate-pulse rounded-full border border-line bg-panel-2/60" />
          ))
        ) : lists.length === 0 && !error ? (
          <p className="text-sm text-dim">Your lists live here. Add the first thing you need below.</p>
        ) : (
          <>
            {ownLists.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={l.id === activeId}
                onClick={() => setActiveId(l.id)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors ${
                  l.id === activeId
                    ? "border-neon-cyan/60 bg-neon-cyan/10 text-star"
                    : "border-line bg-panel-2/60 text-stardust hover:border-neon-cyan/30"
                }`}
              >
                <span aria-hidden="true">{l.icon}</span>
                {l.name}
                {l.unchecked_count > 0 && (
                  <span className="rounded-full bg-neon-cyan/15 px-2 py-0.5 text-xs font-semibold text-neon-cyan">
                    {l.unchecked_count}
                  </span>
                )}
              </button>
            ))}
            {sharedLists.length > 0 && (
              <>
                <span aria-hidden="true" className="flex shrink-0 items-center px-1 text-xs text-dim">
                  Shared with you
                </span>
                {sharedLists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="tab"
                    aria-selected={l.id === activeId}
                    onClick={() => setActiveId(l.id)}
                    title={`Shared by ${l.shared_by}${l.permission === "view" ? " (view only)" : ""}`}
                    className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors ${
                      l.id === activeId
                        ? "border-neon-teal/60 bg-neon-teal/10 text-star"
                        : "border-dashed border-line bg-panel-2/40 text-stardust hover:border-neon-teal/30"
                    }`}
                  >
                    <span aria-hidden="true">{l.icon}</span>
                    {l.name}
                    {l.permission === "view" && (
                      <span className="rounded-full bg-dim/15 px-2 py-0.5 text-xs text-dim">view</span>
                    )}
                    {l.unchecked_count > 0 && (
                      <span className="rounded-full bg-neon-teal/15 px-2 py-0.5 text-xs font-semibold text-neon-teal">
                        {l.unchecked_count}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Share controls for the active own-list */}
      {activeList && !isSharedList && (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShareOpen((v) => !v)}
            aria-expanded={shareOpen}
            className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:border-neon-cyan/40 hover:text-star"
          >
            {shareOpen ? "Close sharing" : "↗ Share this list"}
          </button>
          {shares.length > 0 && !shareOpen && (
            <p className="text-xs text-dim">
              Shared with {shares.length} {shares.length === 1 ? "person" : "people"}
            </p>
          )}
        </div>
      )}

      {/* Share dialog */}
      {shareOpen && activeList && !isSharedList && (
        <div className="rounded-2xl border border-line bg-panel-2/60 p-4">
          <h3 className="text-sm font-semibold text-star">Share &ldquo;{activeList.name}&rdquo;</h3>
          <p className="mt-1 text-xs leading-relaxed text-stardust">
            They&apos;ll get an invite link. If they don&apos;t have Cockpit yet, the link walks
            them through signing up and opens this list first.
          </p>

          <div className="mt-3 flex gap-2">
            <input
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendInvite();
              }}
              placeholder="Their email address"
              aria-label="Email address to share with"
              type="email"
              className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
            />
            <div className="flex shrink-0 rounded-xl border border-line bg-panel-2 p-1" role="radiogroup" aria-label="Permission">
              {(["view", "edit"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={sharePerm === p}
                  onClick={() => setSharePerm(p)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    sharePerm === p ? "bg-neon-cyan/15 text-neon-cyan" : "text-dim hover:text-stardust"
                  }`}
                >
                  {p === "view" ? "View" : "Edit"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={sendInvite}
              disabled={!shareEmail.trim() || shareBusy}
              className="shrink-0 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {shareBusy ? "Sending…" : "Send invite"}
            </button>
          </div>

          {shareError && (
            <p role="alert" className="mt-2 text-xs text-neon-amber">{shareError}</p>
          )}
          {shareSent && (
            <p className="mt-2 break-all text-xs leading-relaxed text-neon-green">{shareSent}</p>
          )}

          <div className="mt-3 space-y-1.5">
            {sharesLoading ? (
              <p className="text-xs text-dim">Loading shares…</p>
            ) : shares.length === 0 ? (
              <p className="text-xs text-dim">Not shared with anyone yet.</p>
            ) : (
              shares.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/40 px-3 py-2"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neon-cyan/15 text-xs font-semibold text-neon-cyan"
                  >
                    {s.email.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-stardust">{s.email}</span>
                  <span className="shrink-0 rounded-full bg-dim/15 px-2 py-0.5 text-xs text-dim">
                    {s.permission === "edit" ? "can edit" : "view only"}
                    {!s.accepted && " · invite pending"}
                  </span>
                  <button
                    type="button"
                    onClick={() => revokeShare(s.id)}
                    aria-label={`Stop sharing with ${s.email}`}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-dim hover:bg-red-500/10 hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* View-only notice */}
      {activeList && isSharedList && activeList.permission === "view" && (
        <p className="rounded-xl border border-line bg-panel-2/40 px-4 py-2.5 text-xs leading-relaxed text-dim">
          👀 You can view this list, but only {activeList.shared_by} can change it.
        </p>
      )}

      {/* Quick add */}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addItem();
          }}
          placeholder={
            !activeId ? "Pick a list first…" : !canEdit ? "View-only list…" : "Add an item…"
          }
          aria-label="Add an item to the current list"
          disabled={!activeId || !canEdit}
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={addItem}
          disabled={!draft.trim() || !activeId || busy || !canEdit}
          className="shrink-0 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-5 py-3 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {/* Items */}
      {unchecked.length === 0 && checked.length === 0 ? (
        <div className="rounded-2xl border border-line bg-panel-2/60 p-6 text-center">
          <p className="text-sm text-stardust">
            Nothing on this list yet. Start with the thing you always forget.
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {unchecked.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => toggleCheck(item)}
                  aria-pressed={false}
                  disabled={!canEdit}
                  className={`flex w-full items-center gap-4 rounded-xl border border-line bg-panel-2/60 text-left transition-colors hover:border-neon-green/40 disabled:cursor-default disabled:hover:border-line ${
                    inStore ? "px-5 py-5" : "px-4 py-3.5"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex shrink-0 items-center justify-center rounded-full border-2 border-dim/60 text-transparent ${
                      inStore ? "h-9 w-9" : "h-7 w-7"
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12.5l5 5L20 6.5" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${inStore ? "text-lg" : "text-sm"} text-star`}>
                      {item.name}
                    </span>
                    {(item.quantity || item.unit || item.recurring) && (
                      <span className="mt-0.5 block text-xs text-dim">
                        {item.quantity ? `${item.quantity} ` : ""}
                        {item.unit ?? ""}
                        {item.recurring ? " · repeats" : ""}
                      </span>
                    )}
                  </span>
                  {canEdit && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${item.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteItem(item);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          deleteItem(item);
                        }
                      }}
                      className="flex shrink-0 items-center justify-center rounded-full p-2 text-dim transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {checked.length > 0 && (
            <details className="rounded-xl border border-line bg-panel-2/40">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-neon-green">
                Got it ✓ ({checked.length})
              </summary>
              <ul className="space-y-1 px-2 pb-3">
                {checked.map((item) => (
                  <li key={item.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleCheck(item)}
                      disabled={!canEdit}
                      className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-dim line-through hover:text-stardust disabled:cursor-default disabled:hover:text-dim"
                    >
                      {item.name}
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        onClick={() => deleteItem(item)}
                        className="flex shrink-0 items-center justify-center rounded-full p-2 text-dim transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
