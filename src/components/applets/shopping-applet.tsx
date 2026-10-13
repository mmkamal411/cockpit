"use client";

import { useCallback, useEffect, useState } from "react";

interface ShoppingList {
  id: string;
  name: string;
  icon: string;
  unchecked_count: number;
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

const SEED_LISTS = [
  { name: "Groceries", icon: "🛒" },
  { name: "Household", icon: "🧹" },
  { name: "Pharmacy", icon: "💊" },
];

/** Shopping — smart lists with big one-hand check targets. */
export function ShoppingApplet() {
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [inStore, setInStore] = useState(false);
  const [busy, setBusy] = useState(false);

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
      // First open: seed the three starter lists.
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
      setActiveId((prev) => prev ?? next[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your lists didn't load. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (activeId) loadItems(activeId);
  }, [activeId, loadItems]);

  async function addItem() {
    const name = draft.trim();
    if (!name || !activeId || busy) return;
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

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  return (
    <div className={`space-y-5 ${inStore ? "text-lg" : ""}`}>
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
          lists.map((l) => (
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
          ))
        )}
      </div>

      {/* Quick add */}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addItem();
          }}
          placeholder={activeId ? "Add an item…" : "Pick a list first…"}
          aria-label="Add an item to the current list"
          disabled={!activeId}
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={addItem}
          disabled={!draft.trim() || !activeId || busy}
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
                  className={`flex w-full items-center gap-4 rounded-xl border border-line bg-panel-2/60 text-left transition-colors hover:border-neon-green/40 ${
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
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => toggleCheck(item)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-dim line-through hover:text-stardust"
                    >
                      {item.name}
                    </button>
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
