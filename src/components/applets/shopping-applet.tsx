"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppletParams } from "@/lib/applet-bus";
import { AutocompleteInput } from "@/components/ui/autocomplete-input";
import { matchCatalog } from "@/lib/grocery-catalog";

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

/** Icons the pilot can pick when creating a list. */
const LIST_ICONS = [
  "🛒",
  "🧹",
  "💊",
  "🎁",
  "📚",
  "🏠",
  "🍎",
  "🎒",
  "⚽",
  "🎄",
  "✈️",
  "🔧",
  "🐶",
  "💡",
];

/** Shopping — smart lists with big one-hand check targets. Lists can be shared. */

interface SpeechRecognitionResultLike {
  transcript: string;
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
  resultIndex: number;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
    </svg>
  );
}

export function ShoppingApplet({ params }: { params?: AppletParams }) {
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftQty, setDraftQty] = useState("");
  const [inStore, setInStore] = useState(false);
  const [busy, setBusy] = useState(false);
  // Voice dictation (Web Speech API; hidden entirely where unsupported).
  const [listening, setListening] = useState(false);
  const [micSupported] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(
        (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
          (window as unknown as { webkitSpeechRecognition?: unknown })
            .webkitSpeechRecognition,
      ),
  );
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Undo toast for quick per-item deletes.
  const [toast, setToast] = useState<{ key: number; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRestore = useRef<{ item: ShoppingItem; listId: string; index: number } | null>(
    null,
  );
  // Swipe-to-delete gesture tracking (touch rows only).
  const touchStartX = useRef<number | null>(null);
  const touchRow = useRef<HTMLElement | null>(null);
  const swipeFired = useRef(false);
  const toastKey = useRef(0);
  // Item edit/delete
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editRecurring, setEditRecurring] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // List management
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListIcon, setNewListIcon] = useState("🛒");
  const [newListBusy, setNewListBusy] = useState(false);
  const [newListError, setNewListError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmDeleteList, setConfirmDeleteList] = useState(false);
  const [deleteListBusy, setDeleteListBusy] = useState(false);
  // Don't re-seed the starter lists if the pilot deleted all of them.
  const skippedSeed = useRef(false);
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
      // Skip if the pilot deliberately deleted all of their lists.
      if (next.length === 0 && !skippedSeed.current) {
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

  async function addItemByName(rawName: string, quantityOverride?: number) {
    const name = rawName.trim();
    if (!name || !activeId || !canEdit) return;
    const parsedQty = parseInt(draftQty.trim(), 10);
    const quantity = Math.max(1, quantityOverride ?? (Number.isFinite(parsedQty) ? parsedQty : 1));
    setBusy(true);
    try {
      const res = await fetch(`/api/shopping/lists/${activeId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, quantity: Number.isFinite(quantity) ? quantity : 1 }),
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
      setError(err instanceof Error ? err.message : "Couldn't add that item.");
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    const name = draft.trim();
    if (!name || !activeId || busy || !canEdit) return;
    const savedQty = draftQty;
    setDraft("");
    setDraftQty("");
    try {
      await addItemByName(name, parseInt(savedQty.trim(), 10) || 1);
    } catch {
      setDraft(name);
      setDraftQty(savedQty);
    }
  }

  /** Suggestion sources: the pilot's own purchase history first, then the built-in catalog. */
  const getItemSuggestions = useCallback(async (query: string): Promise<string[]> => {
    const q = query.trim();
    if (!q) return [];
    let mine: string[] = [];
    try {
      const res = await fetch(`/api/shopping/suggestions?q=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.suggestions)) {
        mine = body.suggestions.filter((s: unknown): s is string => typeof s === "string");
      }
    } catch {
      // History unavailable — catalog still works.
    }
    const seen = new Set(mine.map((m) => m.toLowerCase()));
    const catalog = matchCatalog(q, 8).filter((c) => !seen.has(c.toLowerCase()));
    return [...mine, ...catalog].slice(0, 8);
  }, []);

  /** Voice dictation: "milk, eggs, and bread" → each becomes its own item. */
  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    if (!activeId || !canEdit) return;
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0]?.transcript ?? "";
        if (event.results[i][0]?.isFinal) finalText += t;
        else interim += t;
      }
      setDraft((finalText + interim).trim());
    };
    rec.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      const text = finalText.trim();
      if (!text) return;
      const parts = text
        .split(/,|\s+and\s+/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 120)
        .slice(0, 20);
      setDraft("");
      void (async () => {
        for (const part of parts) {
          await addItemByName(part, 1);
        }
      })();
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
    }
  }

  function showUndoToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastKey.current += 1;
    setToast({ key: toastKey.current, message });
    toastTimer.current = setTimeout(() => {
      setToast(null);
      pendingRestore.current = null;
    }, 6000);
  }

  /** One-tap item delete with Undo — never forces deleting the whole list. */
  async function quickDelete(item: ShoppingItem) {
    if (!activeId || !canEdit) return;
    swipeFired.current = true;
    window.setTimeout(() => {
      swipeFired.current = false;
    }, 400);
    const listId = activeId;
    const index = Math.max(
      0,
      items.findIndex((i) => i.id === item.id),
    );
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    if (!item.checked) {
      setLists((prev) =>
        prev.map((l) =>
          l.id === listId ? { ...l, unchecked_count: Math.max(0, l.unchecked_count - 1) } : l,
        ),
      );
    }
    setEditingId(null);
    try {
      const res = await fetch(`/api/shopping/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      pendingRestore.current = { item, listId, index };
      const label = item.name.length > 40 ? `${item.name.slice(0, 40)}…` : item.name;
      showUndoToast(`Deleted "${label}"`);
    } catch {
      // Roll back the optimistic removal.
      setItems((prev) => {
        const next = [...prev];
        next.splice(Math.min(index, next.length), 0, item);
        return next;
      });
      if (!item.checked) {
        setLists((prev) =>
          prev.map((l) =>
            l.id === listId ? { ...l, unchecked_count: l.unchecked_count + 1 } : l,
          ),
        );
      }
      setError("Couldn't delete that item. Try again.");
    }
  }

  async function undoQuickDelete() {
    const p = pendingRestore.current;
    pendingRestore.current = null;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
    if (!p || !canEdit) return;
    try {
      const res = await fetch(`/api/shopping/lists/${p.listId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: p.item.name,
          quantity: Number.isFinite(p.item.quantity) ? p.item.quantity : undefined,
          unit: p.item.unit ?? undefined,
          notes: p.item.notes ?? undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.item) throw new Error("restore failed");
      const restored = body.item as ShoppingItem;
      setItems((prev) => {
        const next = [...prev];
        next.splice(Math.min(p.index, next.length), 0, restored);
        return next;
      });
      if (!p.item.checked) {
        setLists((prev) =>
          prev.map((l) =>
            l.id === p.listId ? { ...l, unchecked_count: l.unchecked_count + 1 } : l,
          ),
        );
      }
    } catch {
      setError("Couldn't bring that item back. Try again.");
    }
  }

  /** Swipe-to-delete gesture on item rows (touch only; vertical scroll unaffected). */
  function handleRowTouchStart(e: React.TouchEvent<HTMLElement>) {
    touchStartX.current = e.touches[0].clientX;
    touchRow.current = e.currentTarget;
  }

  function handleRowTouchMove(e: React.TouchEvent<HTMLElement>) {
    if (touchStartX.current == null || touchRow.current !== e.currentTarget) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const clamped = Math.max(-88, Math.min(0, dx));
    e.currentTarget.style.transform = clamped < 0 ? `translateX(${clamped}px)` : "";
  }

  function handleRowTouchEnd(item: ShoppingItem) {
    const el = touchRow.current;
    const startX = touchStartX.current;
    touchStartX.current = null;
    touchRow.current = null;
    if (!el || startX == null) return;
    const match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(el.style.transform);
    const dx = match ? parseFloat(match[1]) : 0;
    el.style.transition = "transform 120ms ease-out";
    el.style.transform = "";
    window.setTimeout(() => {
      el.style.transition = "";
    }, 140);
    if (dx <= -56) {
      void quickDelete(item);
    }
  }

  async function toggleCheck(item: ShoppingItem) {
    if (!canEdit) return;
    // A swipe-to-delete just fired — don't also flip the checkbox.
    if (swipeFired.current) return;
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

  function openEdit(item: ShoppingItem) {
    setEditingId(item.id);
    setConfirmDeleteId(null);
    setEditError(null);
    setEditName(item.name);
    setEditQty(item.quantity != null ? String(item.quantity) : "");
    setEditUnit(item.unit ?? "");
    setEditNotes(item.notes ?? "");
    setEditRecurring(item.recurring);
  }

  async function saveEdit(item: ShoppingItem) {
    const name = editName.trim();
    if (!name || editBusy) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const quantity =
        editQty.trim() === "" ? null : Math.max(1, parseInt(editQty.trim(), 10) || 1);
      const unit = editUnit.trim() === "" ? null : editUnit.trim();
      const notes = editNotes.trim() === "" ? null : editNotes.trim();
      const res = await fetch(`/api/shopping/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, quantity, unit, notes, recurring: editRecurring }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't save those changes.",
        );
      }
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...body.item } : i)));
      setEditingId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't save those changes.");
    } finally {
      setEditBusy(false);
    }
  }

  async function deleteItem(item: ShoppingItem) {
    if (deleteBusy) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/shopping/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      if (!item.checked) {
        setLists((prev) =>
          prev.map((l) =>
            l.id === activeId
              ? { ...l, unchecked_count: Math.max(0, l.unchecked_count - 1) }
              : l,
          ),
        );
      }
      setEditingId(null);
      setConfirmDeleteId(null);
    } catch {
      setEditError("Couldn't delete that item. Try again.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function createList() {
    const name = newListName.trim();
    if (!name || newListBusy) return;
    setNewListBusy(true);
    setNewListError(null);
    try {
      const res = await fetch("/api/shopping/lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, icon: newListIcon }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't create that list.",
        );
      }
      const list: ShoppingList = { ...body.list, unchecked_count: 0 };
      setLists((prev) => [...prev, list]);
      setActiveId(list.id);
      setItems([]);
      setNewListName("");
      setNewListOpen(false);
    } catch (err) {
      setNewListError(err instanceof Error ? err.message : "Couldn't create that list.");
    } finally {
      setNewListBusy(false);
    }
  }

  async function renameList() {
    const name = renameName.trim();
    if (!name || !activeId || renameBusy) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/shopping/lists/${activeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't rename that list.",
        );
      }
      setLists((prev) =>
        prev.map((l) => (l.id === activeId ? { ...l, name: body.list.name } : l)),
      );
      setRenaming(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Couldn't rename that list.");
    } finally {
      setRenameBusy(false);
    }
  }

  async function removeList() {
    if (!activeId || deleteListBusy) return;
    setDeleteListBusy(true);
    try {
      const res = await fetch(`/api/shopping/lists/${activeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      const removedId = activeId;
      const remaining = lists.filter((l) => l.id !== removedId);
      if (remaining.length === 0) skippedSeed.current = true;
      setLists(remaining);
      setActiveId(remaining[0]?.id ?? null);
      setItems([]);
      setConfirmDeleteList(false);
    } catch {
      setError("Couldn't delete that list. Try again.");
    } finally {
      setDeleteListBusy(false);
    }
  }

  /** Inline edit panel for one item (name/qty/unit/notes/repeats + delete). */
  function itemEditor(item: ShoppingItem) {
    const deleting = confirmDeleteId === item.id;
    return (
      <div className="mt-2 rounded-xl border border-line bg-panel-2/60 p-4">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            aria-label="Item name"
            placeholder="Item name"
            className="col-span-2 rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
          />
          <input
            type="number"
            min={1}
            value={editQty}
            onChange={(e) => setEditQty(e.target.value)}
            aria-label="Quantity"
            placeholder="Qty"
            className="rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
          />
          <input
            value={editUnit}
            onChange={(e) => setEditUnit(e.target.value)}
            aria-label="Unit"
            placeholder="Unit (e.g. lbs, pack)"
            maxLength={20}
            className="rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
          />
          <input
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            aria-label="Notes"
            placeholder="Notes (optional)"
            maxLength={280}
            className="col-span-2 rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
          />
          <label className="col-span-2 flex cursor-pointer items-center gap-2 text-sm text-stardust">
            <input
              type="checkbox"
              checked={editRecurring}
              onChange={(e) => setEditRecurring(e.target.checked)}
              className="h-4 w-4 accent-neon-cyan"
            />
            Repeats (buy this one regularly)
          </label>
        </div>

        {editError && (
          <p role="alert" className="mt-2 text-xs text-neon-amber">
            {editError}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => saveEdit(item)}
            disabled={editBusy || !editName.trim()}
            className="rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {editBusy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setConfirmDeleteId(null);
            }}
            disabled={editBusy}
            className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:border-neon-cyan/40 hover:text-star"
          >
            Cancel
          </button>
          {deleting ? (
            <>
              <span className="flex items-center text-xs text-dim">Delete this item?</span>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleteBusy}
                className="rounded-xl border border-line bg-panel-2/60 px-3 py-2 text-sm text-stardust transition-colors hover:text-star"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => deleteItem(item)}
                disabled={deleteBusy}
                className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-40"
              >
                {deleteBusy ? "Deleting…" : "Yes, delete"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDeleteId(item.id)}
              className="ml-auto rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-dim transition-colors hover:border-red-500/40 hover:text-red-400"
            >
              🗑 Delete
            </button>
          )}
        </div>
      </div>
    );
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

      {/* New list */}
      <div>
        <button
          type="button"
          onClick={() => {
            setNewListOpen((v) => !v);
            setNewListError(null);
          }}
          aria-expanded={newListOpen}
          className="rounded-xl border border-dashed border-line bg-panel-2/40 px-4 py-2 text-sm font-medium text-dim transition-colors hover:border-neon-cyan/40 hover:text-star"
        >
          {newListOpen ? "Cancel" : "+ New list"}
        </button>
      </div>

      {newListOpen && (
        <div className="rounded-2xl border border-line bg-panel-2/60 p-4">
          <h3 className="text-sm font-semibold text-star">New list</h3>
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="List icon"
          >
            {LIST_ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                role="radio"
                aria-checked={newListIcon === icon}
                onClick={() => setNewListIcon(icon)}
                className={`rounded-xl border px-2.5 py-2 text-lg transition-colors ${
                  newListIcon === icon
                    ? "border-neon-cyan/60 bg-neon-cyan/10"
                    : "border-line bg-panel-2/40 hover:border-neon-cyan/30"
                }`}
              >
                {icon}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createList();
              }}
              placeholder="List name (e.g. Costco run)"
              aria-label="New list name"
              maxLength={80}
              className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={createList}
              disabled={!newListName.trim() || newListBusy}
              className="shrink-0 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-5 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {newListBusy ? "Creating…" : "Create"}
            </button>
          </div>
          {newListError && (
            <p role="alert" className="mt-2 text-xs text-neon-amber">
              {newListError}
            </p>
          )}
        </div>
      )}

      {/* List controls (own lists): share, rename, delete */}
      {activeList && !isSharedList && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShareOpen((v) => !v)}
            aria-expanded={shareOpen}
            className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:border-neon-cyan/40 hover:text-star"
          >
            {shareOpen ? "Close sharing" : "↗ Share this list"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming((v) => !v);
              setRenameName(activeList.name);
              setRenameError(null);
              setConfirmDeleteList(false);
            }}
            aria-expanded={renaming}
            className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:border-neon-cyan/40 hover:text-star"
          >
            ✏️ Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmDeleteList((v) => !v);
              setRenaming(false);
            }}
            aria-expanded={confirmDeleteList}
            className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:border-red-500/40 hover:text-red-400"
          >
            🗑 Delete
          </button>
          {shares.length > 0 && !shareOpen && (
            <p className="text-xs text-dim">
              Shared with {shares.length} {shares.length === 1 ? "person" : "people"}
            </p>
          )}
        </div>
      )}

      {/* Rename form */}
      {renaming && activeList && !isSharedList && (
        <div className="rounded-2xl border border-line bg-panel-2/60 p-4">
          <h3 className="text-sm font-semibold text-star">
            Rename &ldquo;{activeList.name}&rdquo;
          </h3>
          <div className="mt-3 flex gap-2">
            <input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") renameList();
              }}
              aria-label="New list name"
              maxLength={80}
              className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={renameList}
              disabled={!renameName.trim() || renameBusy}
              className="shrink-0 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-5 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {renameBusy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              disabled={renameBusy}
              className="shrink-0 rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-sm text-stardust transition-colors hover:text-star"
            >
              Cancel
            </button>
          </div>
          {renameError && (
            <p role="alert" className="mt-2 text-xs text-neon-amber">
              {renameError}
            </p>
          )}
        </div>
      )}

      {/* Delete-list confirmation */}
      {confirmDeleteList && activeList && !isSharedList && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
          <p className="text-sm font-medium text-star">
            Delete &ldquo;{activeList.name}&rdquo; and everything on it?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-stardust">
            This can&apos;t be undone, but your buying patterns stay in Crystal&apos;s memory.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDeleteList(false)}
              disabled={deleteListBusy}
              className="rounded-xl border border-line bg-panel-2/60 px-4 py-2 text-sm font-medium text-stardust transition-colors hover:text-star"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={removeList}
              disabled={deleteListBusy}
              className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-40"
            >
              {deleteListBusy ? "Deleting…" : "Yes, delete"}
            </button>
          </div>
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

      {/* Quick add — autocomplete, voice dictation, quantity, add */}
      <div className="flex gap-2">
        <AutocompleteInput
          value={draft}
          onChange={setDraft}
          getSuggestions={getItemSuggestions}
          onEnter={() => void addItem()}
          placeholder={
            !activeId ? "Pick a list first…" : !canEdit ? "View-only list…" : "Add an item…"
          }
          ariaLabel="Add an item to the current list"
          disabled={!activeId || !canEdit}
          className="w-full rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none disabled:opacity-50"
        />
        {micSupported && (
          <button
            type="button"
            onClick={toggleDictation}
            disabled={!activeId || !canEdit}
            aria-label={listening ? "Stop voice dictation" : "Dictate shopping items"}
            aria-pressed={listening}
            title={listening ? "Stop listening" : "Dictate items by voice"}
            className={`relative shrink-0 rounded-xl border px-3 py-3 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              listening
                ? "border-red-500/60 bg-red-500/15 text-red-400"
                : "border-line bg-panel-2 text-dim hover:border-neon-cyan/40 hover:text-star"
            }`}
          >
            <MicIcon />
            {listening && (
              <span className="absolute -right-1 -top-1 flex h-3 w-3" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
              </span>
            )}
          </button>
        )}
        <input
          type="number"
          min={1}
          value={draftQty}
          onChange={(e) => setDraftQty(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addItem();
          }}
          placeholder="Qty"
          aria-label="Quantity (defaults to 1)"
          disabled={!activeId || !canEdit}
          className="w-16 shrink-0 rounded-xl border border-line bg-panel-2 px-3 py-3 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void addItem()}
          disabled={!draft.trim() || !activeId || busy || !canEdit}
          className="shrink-0 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-3 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {listening && (
        <p className="text-xs text-dim" role="status">
          Listening… name items separated by &ldquo;and&rdquo; or commas.
        </p>
      )}

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
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl">
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 flex items-center justify-end rounded-xl bg-red-500/15 pr-4 text-sm font-medium text-red-400"
                    >
                      Delete
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleCheck(item)}
                      onTouchStart={handleRowTouchStart}
                      onTouchMove={handleRowTouchMove}
                      onTouchEnd={() => handleRowTouchEnd(item)}
                      style={{ touchAction: "pan-y" }}
                      aria-pressed={false}
                      disabled={!canEdit}
                      className={`relative flex w-full min-w-0 items-center gap-4 rounded-xl border border-line bg-panel-2/60 text-left transition-colors hover:border-neon-green/40 disabled:cursor-default disabled:hover:border-line ${
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
                      {item.notes && (
                        <span className="mt-0.5 block truncate text-xs text-dim">{item.notes}</span>
                      )}
                    </span>
                    </button>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => void quickDelete(item)}
                      aria-label={`Delete ${item.name}`}
                      title={`Delete ${item.name}`}
                      className="shrink-0 self-center rounded-xl border border-line bg-panel-2/60 px-3 py-3 text-dim transition-colors hover:border-red-500/40 hover:text-red-400"
                    >
                      <TrashIcon />
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        editingId === item.id ? setEditingId(null) : openEdit(item)
                      }
                      aria-label={`Edit ${item.name}`}
                      aria-expanded={editingId === item.id}
                      className={`shrink-0 self-center rounded-xl border px-3 py-3 text-sm transition-colors ${
                        editingId === item.id
                          ? "border-neon-cyan/60 bg-neon-cyan/10 text-neon-cyan"
                          : "border-line bg-panel-2/60 text-dim hover:border-neon-cyan/40 hover:text-star"
                      }`}
                    >
                      ✏️
                    </button>
                  )}
                </div>
                {editingId === item.id && canEdit && itemEditor(item)}
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
                    <div className="flex items-center gap-2">
                      <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg">
                        <div
                          aria-hidden="true"
                          className="absolute inset-0 flex items-center justify-end rounded-lg bg-red-500/15 pr-3 text-xs font-medium text-red-400"
                        >
                          Delete
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleCheck(item)}
                          onTouchStart={handleRowTouchStart}
                          onTouchMove={handleRowTouchMove}
                          onTouchEnd={() => handleRowTouchEnd(item)}
                          style={{ touchAction: "pan-y" }}
                          disabled={!canEdit}
                          className="relative flex w-full min-w-0 items-center gap-3 rounded-lg bg-panel-2/40 px-3 py-2 text-left text-sm text-dim line-through hover:text-stardust disabled:cursor-default disabled:hover:text-dim"
                        >
                          <span className="truncate">{item.name}</span>
                        </button>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => void quickDelete(item)}
                          aria-label={`Delete ${item.name}`}
                          title={`Delete ${item.name}`}
                          className="shrink-0 rounded-lg px-2 py-1 text-dim transition-colors hover:bg-red-500/10 hover:text-red-400"
                        >
                          <TrashIcon />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            editingId === item.id ? setEditingId(null) : openEdit(item)
                          }
                          aria-label={`Edit ${item.name}`}
                          aria-expanded={editingId === item.id}
                          className={`shrink-0 rounded-lg px-2 py-1 text-xs transition-colors ${
                            editingId === item.id ? "text-neon-cyan" : "text-dim hover:text-star"
                          }`}
                        >
                          ✏️
                        </button>
                      )}
                    </div>
                    {editingId === item.id && canEdit && (
                      <div className="px-2">{itemEditor(item)}</div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {/* Undo toast for quick item deletes */}
      {toast && (
        <div
          key={toast.key}
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-panel-2 px-4 py-3 shadow-xl shadow-black/50"
        >
          <span className="max-w-56 truncate text-sm text-stardust">{toast.message}</span>
          <button
            type="button"
            onClick={() => void undoQuickDelete()}
            className="shrink-0 rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
