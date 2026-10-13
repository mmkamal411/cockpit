"use client";

import { useEffect, useMemo, useState } from "react";
import { parseTodo } from "@/lib/parse-todo";
import { describeRecurrence, parseRecurrence } from "@/lib/recurrence";
import {
  defaultReminderAt,
  useTodos,
  type TodoItem,
  type TodoList,
  type TodoPriority,
  type TodoShare,
} from "@/lib/use-todos";

/**
 * TodoApplet — the rich to-do surface (rendered inside the Today applet).
 *
 * Lists (own + shared), Today / Upcoming / Assigned-to-me views, quick-add
 * with natural-language parsing and tap-to-revert chips, P1–P4 priorities,
 * sections, sub-tasks, recurrence, assign-to-person, reminders, list
 * sharing, Google Tasks sync, and Crystal task breakdown.
 *
 * Standing rules: no blank pages (every state has content), plain-English
 * errors with a recovery path, and failures never block the list — the
 * offline queue keeps everything working without a connection.
 */

type View = "list" | "today" | "upcoming" | "mine";

const VIEW_LABELS: { id: View; label: string }[] = [
  { id: "list", label: "Lists" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "mine", label: "Assigned to me" },
];

const PRIORITY_META: Record<TodoPriority, { label: string; chip: string; dot: string }> = {
  p1: { label: "P1", chip: "border-red-400/50 bg-red-400/10 text-red-300", dot: "bg-red-400" },
  p2: { label: "P2", chip: "border-amber-400/50 bg-amber-400/10 text-amber-300", dot: "bg-amber-400" },
  p3: { label: "P3", chip: "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan", dot: "bg-neon-cyan" },
  p4: { label: "P4", chip: "border-dim/40 bg-panel-2 text-dim", dot: "bg-dim" },
};

const LIST_COLORS = ["#67e8f9", "#5eead4", "#c4b5fd", "#f9a8d4", "#fcd34d", "#86efac", "#fca5a5"];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatDue(dueAt: number | null | undefined): string | null {
  if (typeof dueAt !== "number") return null;
  const day = new Date(dueAt);
  const today = new Date();
  const diffDays = Math.round((startOfDay(day) - startOfDay(today)) / 86_400_000);
  const time = day.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (diffDays < 0) return `Overdue · ${day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return `Tomorrow · ${time}`;
  if (diffDays < 7) return `${day.toLocaleDateString(undefined, { weekday: "short" })} · ${time}`;
  return day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function dueInputValue(dueAt: number | null | undefined): string {
  if (typeof dueAt !== "number") return "";
  const d = new Date(dueAt);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function timeInputValue(dueAt: number | null | undefined): string {
  if (typeof dueAt !== "number") return "";
  const d = new Date(dueAt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Combine a date input + optional time input into epoch ms (local time). */
function combineDateTime(dateStr: string, timeStr: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, mo, d] = dateStr.split("-").map(Number);
  let h = 9;
  let mi = 0;
  const tm = timeStr.match(/^(\d{2}):(\d{2})$/);
  if (tm) {
    h = Number(tm[1]);
    mi = Number(tm[2]);
  }
  const dt = new Date(y, mo - 1, d, tm ? h : 9, tm ? mi : 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

function priorityRank(p: TodoPriority | null | undefined): number {
  if (p === "p1") return 0;
  if (p === "p2") return 1;
  if (p === "p3") return 2;
  return 3;
}

function sortTodos(a: TodoItem, b: TodoItem): number {
  const pr = priorityRank(a.priority) - priorityRank(b.priority);
  if (pr !== 0) return pr;
  const ad = a.dueAt ?? Number.POSITIVE_INFINITY;
  const bd = b.dueAt ?? Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  return b.createdAt - a.createdAt;
}

export function TodoApplet({ initialListId }: { initialListId?: string }) {
  const {
    todos,
    lists,
    people,
    myPilotId,
    loading,
    signedIn,
    syncError,
    retrySync,
    addTodo,
    toggleTodo,
    updateTodo,
    deleteTodo,
    createList,
    updateList,
    deleteList,
    getShares,
    shareList,
    revokeShare,
    requestBreakdown,
  } = useTodos();

  const [view, setView] = useState<View>("list");
  // The invite flow can deep-link a freshly shared list via the initial id.
  const [activeListId, setActiveListId] = useState<string | null>(initialListId ?? null);
  // Mount-time clock for the "today / upcoming / reminders" cutoffs.
  const [nowMs] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [reverted, setReverted] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<TodoList | null>(null);
  const [showTasksPanel, setShowTasksPanel] = useState(false);
  const [listMenuId, setListMenuId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // The invite flow can deep-link a freshly shared list; otherwise the
  // first own list is the default. Derived (not an effect) so there's no
  // cascading render.
  const resolvedListId =
    activeListId ?? (lists.find((l) => l.mine) ?? lists[0])?.id ?? null;

  const activeList = lists.find((l) => l.id === resolvedListId) ?? null;
  const canEditActive = !activeList || activeList.permission !== "view";

  // --- Derived sets ---
  const childrenByParent = useMemo(() => {
    const map = new Map<string, TodoItem[]>();
    for (const t of todos) {
      if (t.parentTodoId) {
        const arr = map.get(t.parentTodoId) ?? [];
        arr.push(t);
        map.set(t.parentTodoId, arr);
      }
    }
    return map;
  }, [todos]);

  const visibleTodos = useMemo(() => {
    const todayStart = startOfDay(new Date(nowMs));
    let pool = todos.filter((t) => !t.parentTodoId);
    if (view === "list") {
      pool = resolvedListId ? pool.filter((t) => t.listId === resolvedListId) : pool;
    } else if (view === "today") {
      pool = pool.filter(
        (t) => !t.done && t.dueAt != null && startOfDay(new Date(t.dueAt)) <= todayStart,
      );
    } else if (view === "upcoming") {
      const weekOut = todayStart + 7 * 86_400_000;
      pool = pool.filter(
        (t) =>
          !t.done &&
          t.dueAt != null &&
          startOfDay(new Date(t.dueAt)) > todayStart &&
          startOfDay(new Date(t.dueAt)) <= weekOut,
      );
    } else {
      pool = pool.filter((t) => !t.done && myPilotId != null && t.assignedToPilotId === myPilotId);
    }
    return [...pool].sort(sortTodos);
  }, [todos, view, resolvedListId, myPilotId, nowMs]);

  const doneCount = useMemo(
    () =>
      todos.filter((t) => {
        if (!t.done || t.parentTodoId) return false;
        if (view === "list") return !resolvedListId || t.listId === resolvedListId;
        return true;
      }).length,
    [todos, view, resolvedListId],
  );

  // In-app due reminders: reminder time passed, not done, not dismissed.
  const dueReminders = useMemo(
    () =>
      todos.filter(
        (t) =>
          !t.done &&
          !t.parentTodoId &&
          t.reminderAt != null &&
          t.reminderAt <= nowMs &&
          // Don't nag about ancient reminders — the email run covers those.
          t.reminderAt > nowMs - 24 * 60 * 60 * 1000,
      ),
    [todos, nowMs],
  );

  // --- Quick add with tap-to-revert parse chips ---
  const parsed = useMemo(() => parseTodo(draft), [draft]);

  interface Chip {
    key: string;
    label: string;
  }
  const chips = useMemo(() => {
    const out: Chip[] = [];
    if (parsed.dueAt != null && !reverted.has("due")) {
      const label = formatDue(parsed.dueAt);
      if (label) out.push({ key: "due", label: `📅 ${label}` });
    }
    if (parsed.priority && !reverted.has("priority")) {
      out.push({ key: "priority", label: `⚑ ${parsed.priority.toUpperCase()}` });
    }
    if (parsed.project && !reverted.has("project")) {
      out.push({ key: "project", label: `#${parsed.project}` });
    }
    if (parsed.assignee && !reverted.has("assignee")) {
      out.push({ key: "assignee", label: `→ ${parsed.assignee}` });
    }
    if (parsed.recurrence && !reverted.has("recurrence")) {
      const desc = describeRecurrence(parsed.recurrence);
      out.push({ key: "recurrence", label: desc ? `🔁 ${desc}` : `🔁 ${parsed.recurrence}` });
    }
    return out;
  }, [parsed, reverted]);

  function revertChip(key: string) {
    setReverted((prev) => new Set(prev).add(key));
  }

  async function addQuickTodo() {
    setAddError(null);
    const raw = draft.trim();
    if (!raw) return;
    const p = parseTodo(raw);
    // Tap-to-revert: a reverted chip means the pilot wants those words back
    // in the text, so the raw input wins. Otherwise the stripped text wins
    // (unless stripping ate everything, e.g. the input was just "tomorrow").
    const finalText = reverted.size > 0 || p.text.trim() === "" ? raw : p.text;
    try {
      const useDue = !reverted.has("due") && !reverted.has("recurrence");
      const dueAt = useDue ? (p.dueAt ?? null) : null;
      const listId = (() => {
        if (!reverted.has("project") && p.project) {
          const match = lists.find((l) => l.name.toLowerCase() === p.project!.toLowerCase());
          if (match) return match.id;
        }
        return resolvedListId;
      })();
      const assignedToPilotId = (() => {
        if (reverted.has("assignee") || !p.assignee) return null;
        const person = people.find((pp) => pp.name.toLowerCase() === p.assignee!.toLowerCase());
        return person?.id ?? null;
      })();
      const recurrence =
        !reverted.has("recurrence") && p.recurrence && parseRecurrence(p.recurrence)
          ? p.recurrence
          : null;
      await addTodo(finalText, {
        dueAt,
        timed: p.hasTime ?? false,
        priority: !reverted.has("priority") ? (p.priority ?? null) : null,
        listId,
        assignedToPilotId,
        recurrence,
      });
      setDraft("");
      setReverted(new Set());
    } catch {
      setAddError("Give your to-do a few words first.");
    }
  }

  async function handleCreateList() {
    const name = newListName.trim();
    if (!name) return;
    setCreatingList(true);
    try {
      const list = await createList(name, LIST_COLORS[lists.length % LIST_COLORS.length]);
      setNewListName("");
      setActiveListId(list.id);
      setView("list");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Couldn't create that list. Try again.");
    } finally {
      setCreatingList(false);
    }
  }

  // --- Render ---
  // Group the list view by section (ungrouped first). useMemo lives with
  // the other hooks — above the loading early-return.
  const sections = useMemo(() => {
    if (view !== "list") return null;
    const map = new Map<string | null, TodoItem[]>();
    for (const t of visibleTodos) {
      const key = t.section ?? null;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) =>
      a[0] === null ? -1 : b[0] === null ? 1 : a[0].localeCompare(b[0]),
    );
  }, [visibleTodos, view]);

  if (loading) {
    return (
      <div className="space-y-2" aria-label="Loading your to-dos">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl border border-line bg-panel-2/60" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* View tabs */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="To-do views">
        {VIEW_LABELS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              view === v.id
                ? "border border-neon-cyan/50 bg-neon-cyan/15 text-neon-cyan"
                : "border border-line bg-panel-2/40 text-stardust hover:border-neon-cyan/30"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* List switcher */}
      {view === "list" && (
        <div className="space-y-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Your lists">
            {lists.map((l) => (
              <div key={l.id} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setActiveListId(l.id);
                    setListMenuId(null);
                  }}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    resolvedListId === l.id
                      ? "border-neon-green/50 bg-neon-green/10 text-neon-green"
                      : "border-line bg-panel-2/40 text-stardust hover:border-neon-green/30"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: l.color ?? "#67e8f9" }}
                  />
                  {l.name}
                  {!l.mine && (
                    <span className="text-[10px] text-dim" title="Shared with you">
                      · shared
                    </span>
                  )}
                </button>
                {l.mine && (
                  <button
                    type="button"
                    aria-label={`List options for ${l.name}`}
                    onClick={() => setListMenuId(listMenuId === l.id ? null : l.id)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-panel-2 text-[10px] text-dim hover:text-star"
                  >
                    ⋯
                  </button>
                )}
              </div>
            ))}
            {signedIn !== false && (
              <div className="flex shrink-0 items-center gap-1.5">
                <input
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateList();
                  }}
                  placeholder="New list…"
                  aria-label="New list name"
                  className="w-24 rounded-full border border-line bg-panel-2/40 px-3 py-1.5 text-xs text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateList()}
                  disabled={!newListName.trim() || creatingList}
                  className="rounded-full border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-1.5 text-xs font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  + Add
                </button>
              </div>
            )}
          </div>

          {/* List menu: rename / share / delete */}
          {listMenuId && (
            <ListMenu
              list={lists.find((l) => l.id === listMenuId) ?? null}
              onClose={() => setListMenuId(null)}
              onRename={async (name) => {
                await updateList(listMenuId, { name });
                setListMenuId(null);
              }}
              onShare={(list) => {
                setShareFor(list);
                setListMenuId(null);
              }}
              onDelete={async () => {
                if (
                  window.confirm(
                    "Delete this list and all its to-dos? This can't be undone.",
                  )
                ) {
                  await deleteList(listMenuId);
                  setActiveListId(null);
                }
                setListMenuId(null);
              }}
            />
          )}
        </div>
      )}

      {/* Sync status */}
      {syncError !== null && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-center">
          <p className="text-sm text-star">{syncError}</p>
          <button
            type="button"
            onClick={() => void retrySync()}
            className="mt-2 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
          >
            Try syncing again
          </button>
        </div>
      )}

      {/* In-app due reminders */}
      {dueReminders.length > 0 && !bannerDismissed && (
        <div className="rounded-2xl border border-neon-cyan/30 bg-neon-cyan/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-star">
                ⏰ {dueReminders.length === 1 ? "A reminder is due" : `${dueReminders.length} reminders are due`}
              </p>
              <ul className="mt-1.5 space-y-1">
                {dueReminders.slice(0, 3).map((t) => (
                  <li key={t.id} className="text-xs text-stardust">
                    · {t.text}
                  </li>
                ))}
                {dueReminders.length > 3 && (
                  <li className="text-xs text-dim">· and {dueReminders.length - 3} more…</li>
                )}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss reminders"
              className="shrink-0 rounded-lg px-2 py-1 text-dim hover:text-star"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Quick add */}
      {canEditActive && (
        <div>
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setReverted(new Set());
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addQuickTodo();
              }}
              placeholder="Add a to-do — try “dentist tomorrow at 3pm p1 #Family”…"
              aria-label="Add a to-do"
              className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void addQuickTodo()}
              disabled={!draft.trim()}
              className="shrink-0 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {chips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Detected details — tap to remove">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => revertChip(c.key)}
                  title="Tap to keep these words as plain text instead"
                  className="rounded-full border border-neon-cyan/30 bg-neon-cyan/5 px-2.5 py-0.5 text-[11px] text-neon-cyan transition-colors hover:border-red-400/40 hover:text-red-300"
                >
                  {c.label} ✕
                </button>
              ))}
            </div>
          )}
          {addError !== null && <p className="mt-1.5 text-xs text-red-400">{addError}</p>}
        </div>
      )}

      {/* The list */}
      {visibleTodos.length === 0 ? (
        <div className="rounded-2xl border border-line bg-panel-2/60 p-6 text-center">
          <p className="text-sm text-stardust">
            {view === "today" && "Nothing due today. Clear skies."}
            {view === "upcoming" && "Nothing coming up in the next week."}
            {view === "mine" && "Nothing assigned to you right now."}
            {view === "list" &&
              (todos.length === 0
                ? "Your list is empty. Add the first thing on your mind — Crystal will keep it in sight all day."
                : "Everything here is done. Nice work.")}
          </p>
          {view === "list" && doneCount > 0 && (
            <p className="mt-1 text-xs text-dim">{doneCount} completed {doneCount === 1 ? "task" : "tasks"} — nice.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {(sections ?? [["__all", visibleTodos]] as [string | null, TodoItem[]][]).map(
            ([section, items]) => (
              <div key={section ?? "__none"}>
                {section !== null && section !== "__all" && (
                  <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-dim">
                    {section}
                  </p>
                )}
                <ul className="space-y-2">
                  {items.map((t) => (
                    <TodoRow
                      key={t.id}
                      todo={t}
                      subtasks={childrenByParent.get(t.id) ?? []}
                      lists={lists}
                      people={people}
                      myPilotId={myPilotId}
                      expanded={expandedId === t.id}
                      canEdit={canEditActive}
                      onToggle={() => void toggleTodo(t.id)}
                      onExpand={() => setExpandedId(expandedId === t.id ? null : t.id)}
                      onToggleChild={(id) => void toggleTodo(id)}
                      onDeleteChild={(id) => void deleteTodo(id)}
                      onAddSubtask={async (text) => {
                        await addTodo(text, {
                          parentTodoId: t.id,
                          listId: t.listId,
                          priority: t.priority,
                        });
                      }}
                      onUpdate={(patch) => updateTodo(t.id, patch)}
                      onDelete={() => void deleteTodo(t.id)}
                      onBreakdown={async () => {
                        await requestBreakdown(t.id);
                      }}
                    />
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-dim">
          {signedIn === false
            ? "Saved on this device — sign in to sync to your cloud."
            : "Saved on this device, synced to your cloud when you're signed in."}
        </p>
        <button
          type="button"
          onClick={() => setShowTasksPanel((s) => !s)}
          className="rounded-lg px-2 py-1 text-xs text-dim transition-colors hover:text-neon-cyan"
        >
          {showTasksPanel ? "Hide Google Tasks" : "Google Tasks"}
        </button>
      </div>

      {showTasksPanel && <GoogleTasksPanel />}

      {shareFor && (
        <ShareDialog
          list={shareFor}
          onClose={() => setShareFor(null)}
          getShares={getShares}
          shareList={shareList}
          revokeShare={revokeShare}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Todo row + detail editor                                            */
/* ------------------------------------------------------------------ */

function TodoRow({
  todo,
  subtasks,
  lists,
  people,
  myPilotId,
  expanded,
  canEdit,
  onToggle,
  onExpand,
  onToggleChild,
  onDeleteChild,
  onAddSubtask,
  onUpdate,
  onDelete,
  onBreakdown,
}: {
  todo: TodoItem;
  subtasks: TodoItem[];
  lists: TodoList[];
  people: { id: string; name: string }[];
  myPilotId: string | null;
  expanded: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onToggleChild: (id: string) => void;
  onDeleteChild: (id: string) => void;
  onAddSubtask: (text: string) => Promise<void>;
  onUpdate: (patch: Partial<TodoItem>) => Promise<void>;
  onDelete: () => void;
  onBreakdown: () => Promise<void>;
}) {
  const doneSubs = subtasks.filter((c) => c.done).length;
  const assignee = people.find((p) => p.id === todo.assignedToPilotId);
  const dueLabel = formatDue(todo.dueAt);
  const isOverdue =
    typeof todo.dueAt === "number" && !todo.done && startOfDay(new Date(todo.dueAt)) < startOfDay(new Date());

  return (
    <li>
      <div
        className={`rounded-xl border px-4 py-3 transition-colors ${
          todo.done
            ? "border-line bg-panel-2/40"
            : "border-line bg-panel-2/60 hover:border-neon-cyan/30"
        }`}
      >
        <div className="flex w-full items-center gap-3">
          <button
            type="button"
            onClick={onToggle}
            disabled={!canEdit}
            aria-pressed={todo.done}
            aria-label={todo.done ? `Mark “${todo.text}” as not done` : `Mark “${todo.text}” as done`}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed ${
              todo.done
                ? "border-neon-green bg-neon-green/20 text-neon-green"
                : "border-dim/60 text-transparent hover:border-neon-green/60"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onExpand}
            aria-expanded={expanded}
            className="min-w-0 flex-1 text-left"
          >
            <p className={`text-sm ${todo.done ? "text-dim line-through" : "text-star"}`}>
              {todo.text}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {todo.priority && todo.priority !== "p4" && (
                <span className={`rounded border px-1.5 py-px text-[10px] font-bold ${PRIORITY_META[todo.priority].chip}`}>
                  {PRIORITY_META[todo.priority].label}
                </span>
              )}
              {dueLabel !== null && (
                <span className={`text-xs ${isOverdue ? "font-medium text-red-400" : "text-neon-cyan"}`}>
                  {dueLabel}
                </span>
              )}
              {todo.recurrence && describeRecurrence(todo.recurrence) && (
                <span className="text-xs text-dim" title={todo.recurrence}>
                  🔁 {describeRecurrence(todo.recurrence)}
                </span>
              )}
              {assignee && (
                <span className="text-xs text-purple-300" title={`Assigned to ${assignee.name}`}>
                  → {assignee.id === myPilotId ? "me" : assignee.name}
                </span>
              )}
              {todo.reminderAt != null && !todo.done && (
                <span className="text-xs text-dim" title="Reminder set">⏰</span>
              )}
              {subtasks.length > 0 && (
                <span className="text-xs text-dim">
                  {doneSubs}/{subtasks.length} sub-tasks
                </span>
              )}
            </div>
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete “${todo.text}”`}
              className="shrink-0 rounded-lg px-2 py-1 text-dim transition-colors hover:bg-red-400/10 hover:text-red-300"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>

        {subtasks.length > 0 && (
          <ul className="ml-8 mt-2 space-y-1.5 border-l border-line pl-3">
            {subtasks.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggleChild(c.id)}
                  disabled={!canEdit}
                  aria-pressed={c.done}
                  aria-label={c.done ? `Mark “${c.text}” as not done` : `Mark “${c.text}” as done`}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed ${
                    c.done
                      ? "border-neon-green bg-neon-green/20 text-neon-green"
                      : "border-dim/60 text-transparent hover:border-neon-green/60"
                  }`}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 12.5l5 5L20 6.5" />
                  </svg>
                </button>
                <span className={`min-w-0 flex-1 truncate text-[13px] ${c.done ? "text-dim line-through" : "text-stardust"}`}>
                  {c.text}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => onDeleteChild(c.id)}
                    aria-label={`Delete sub-task “${c.text}”`}
                    className="shrink-0 rounded px-1 text-dim hover:text-red-300"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {expanded && (
          <DetailEditor
            key={todo.id}
            todo={todo}
            lists={lists}
            people={people}
            canEdit={canEdit}
            onUpdate={onUpdate}
            onAddSubtask={onAddSubtask}
            onBreakdown={onBreakdown}
          />
        )}
      </div>
    </li>
  );
}

function DetailEditor({
  todo,
  lists,
  people,
  canEdit,
  onUpdate,
  onAddSubtask,
  onBreakdown,
}: {
  todo: TodoItem;
  lists: TodoList[];
  people: { id: string; name: string }[];
  canEdit: boolean;
  onUpdate: (patch: Partial<TodoItem>) => Promise<void>;
  onAddSubtask: (text: string) => Promise<void>;
  onBreakdown: () => Promise<void>;
}) {
  const [text, setText] = useState(todo.text);
  const [notes, setNotes] = useState(todo.notes ?? "");
  const [date, setDate] = useState(dueInputValue(todo.dueAt));
  const [time, setTime] = useState(timeInputValue(todo.dueAt));
  const [recurrence, setRecurrence] = useState(todo.recurrence ?? "");
  const [section, setSection] = useState(todo.section ?? "");
  const [subDraft, setSubDraft] = useState("");
  const [breaking, setBreaking] = useState(false);
  const [breakError, setBreakError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  async function save(patch: Partial<TodoItem>) {
    if (!canEdit) return;
    await onUpdate(patch);
    setSavedTick((t) => t + 1);
  }

  const recurrenceValid = recurrence.trim() === "" || parseRecurrence(recurrence.trim()) !== null;

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3" aria-label={`Details for ${todo.text}`}>
      <div>
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim" htmlFor={`todo-text-${todo.id}`}>
          Task
        </label>
        <input
          id={`todo-text-${todo.id}`}
          value={text}
          disabled={!canEdit}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text.trim() && text.trim() !== todo.text) void save({ text: text.trim() });
          }}
          className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-star focus:border-neon-cyan/60 focus:outline-none disabled:opacity-60"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim" htmlFor={`todo-date-${todo.id}`}>
            Due date
          </label>
          <input
            id={`todo-date-${todo.id}`}
            type="date"
            value={date}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value;
              setDate(v);
              if (!canEdit) return;
              if (v === "") {
                void save({ dueAt: null, reminderAt: null });
              } else {
                const ms = combineDateTime(v, time);
                if (ms !== null) {
                  const timed = time !== "";
                  void save({ dueAt: ms, reminderAt: defaultReminderAt(ms, timed) });
                }
              }
            }}
            className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-star focus:border-neon-cyan/60 focus:outline-none disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim" htmlFor={`todo-time-${todo.id}`}>
            Time <span className="normal-case text-dim/70">(optional)</span>
          </label>
          <input
            id={`todo-time-${todo.id}`}
            type="time"
            value={time}
            disabled={!canEdit || date === ""}
            onChange={(e) => {
              const v = e.target.value;
              setTime(v);
              if (!canEdit || date === "") return;
              const ms = combineDateTime(date, v);
              if (ms !== null) void save({ dueAt: ms, reminderAt: defaultReminderAt(ms, v !== "") });
            }}
            className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-star focus:border-neon-cyan/60 focus:outline-none disabled:opacity-60"
          />
        </div>
      </div>

      <div>
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim">
          Priority
        </span>
        <div className="flex gap-1.5">
          {(["p1", "p2", "p3", "p4"] as TodoPriority[]).map((p) => (
            <button
              key={p}
              type="button"
              disabled={!canEdit}
              onClick={() => void save({ priority: todo.priority === p ? null : p })}
              aria-pressed={todo.priority === p}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed ${
                todo.priority === p
                  ? PRIORITY_META[p].chip
                  : "border-line bg-panel-2/40 text-dim hover:text-star"
              }`}
            >
              {PRIORITY_META[p].label}
            </button>
          ))}
          <span className="self-center text-[11px] text-dim">P1 is most urgent</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim" htmlFor={`todo-list-${todo.id}`}>
            List
          </label>
          <select
            id={`todo-list-${todo.id}`}
            value={todo.listId ?? ""}
            disabled={!canEdit}
            onChange={(e) => void save({ listId: e.target.value || null })}
            className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-star focus:border-neon-cyan/60 focus:outline-none disabled:opacity-60"
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {!l.mine ? " (shared)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim" htmlFor={`todo-section-${todo.id}`}>
            Section
          </label>
          <input
            id={`todo-section-${todo.id}`}
            value={section}
            disabled={!canEdit}
            onChange={(e) => setSection(e.target.value)}
            onBlur={() => {
              const v = section.trim();
              if (v !== (todo.section ?? "")) void save({ section: v === "" ? null : v });
            }}
            placeholder="e.g. Groceries"
            className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none disabled:opacity-60"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim" htmlFor={`todo-assignee-${todo.id}`}>
            Assigned to
          </label>
          <select
            id={`todo-assignee-${todo.id}`}
            value={todo.assignedToPilotId ?? ""}
            disabled={!canEdit}
            onChange={(e) => void save({ assignedToPilotId: e.target.value === "" ? null : e.target.value })}
            className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-star focus:border-neon-cyan/60 focus:outline-none disabled:opacity-60"
          >
            <option value="">Nobody yet</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim" htmlFor={`todo-recur-${todo.id}`}>
            Repeats
          </label>
          <input
            id={`todo-recur-${todo.id}`}
            value={recurrence}
            disabled={!canEdit}
            onChange={(e) => setRecurrence(e.target.value)}
            onBlur={() => {
              const v = recurrence.trim().toLowerCase();
              if (v !== (todo.recurrence ?? "")) void save({ recurrence: v === "" ? null : v });
            }}
            placeholder="every Monday"
            className={`w-full rounded-lg border bg-panel-2 px-3 py-2 text-sm text-star placeholder:text-dim focus:outline-none disabled:opacity-60 ${
              recurrenceValid ? "border-line focus:border-neon-cyan/60" : "border-red-400/50 focus:border-red-400/70"
            }`}
          />
          {!recurrenceValid && (
            <p className="mt-1 text-[11px] text-red-400">
              Try “every day”, “every Monday”, or “every 2 weeks”.
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim" htmlFor={`todo-notes-${todo.id}`}>
          Notes
        </label>
        <textarea
          id={`todo-notes-${todo.id}`}
          value={notes}
          disabled={!canEdit}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes.trim() !== (todo.notes ?? "")) {
              void save({ notes: notes.trim() === "" ? null : notes.trim() });
            }
          }}
          rows={2}
          placeholder="Anything Crystal should remember about this one…"
          className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none disabled:opacity-60"
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-line bg-panel-2/40 px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-star">
          <input
            type="checkbox"
            checked={todo.reminderAt != null}
            disabled={!canEdit || todo.dueAt == null}
            onChange={(e) => {
              if (!canEdit) return;
              if (e.target.checked && todo.dueAt != null) {
                void save({ reminderAt: defaultReminderAt(todo.dueAt, time !== "") });
              } else {
                void save({ reminderAt: null });
              }
            }}
            className="h-4 w-4 accent-cyan-400"
          />
          Remind me
        </label>
        <span className="text-xs text-dim">
          {todo.reminderAt != null
            ? `⏰ ${new Date(todo.reminderAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
            : todo.dueAt == null
              ? "Set a due date first"
              : "Off"}
        </span>
      </div>

      {/* Sub-tasks */}
      {canEdit && (
        <div>
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-dim">
            Sub-tasks
          </span>
          <div className="flex gap-2">
            <input
              value={subDraft}
              onChange={(e) => setSubDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && subDraft.trim()) {
                  void onAddSubtask(subDraft.trim()).then(() => setSubDraft(""));
                }
              }}
              placeholder="Add a sub-task…"
              aria-label="Add a sub-task"
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
            />
            <button
              type="button"
              disabled={!subDraft.trim()}
              onClick={() => void onAddSubtask(subDraft.trim()).then(() => setSubDraft(""))}
              className="shrink-0 rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-1.5 text-xs font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <button
            type="button"
            disabled={breaking}
            onClick={async () => {
              setBreakError(null);
              setBreaking(true);
              try {
                await onBreakdown();
              } catch (e) {
                setBreakError(
                  e instanceof Error ? e.message : "Crystal couldn't break that down. Try again.",
                );
              } finally {
                setBreaking(false);
              }
            }}
            className="mt-2 rounded-lg border border-purple-400/40 bg-purple-400/10 px-3 py-1.5 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {breaking ? "✨ Crystal is thinking…" : "✨ Ask Crystal to break this down"}
          </button>
          {breakError !== null && <p className="mt-1 text-xs text-red-400">{breakError}</p>}
        </div>
      )}

      <p aria-live="polite" className="text-[11px] text-dim">
        {savedTick > 0 ? "Saved ✓" : ""}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* List menu (rename / share / delete)                                  */
/* ------------------------------------------------------------------ */

function ListMenu({
  list,
  onClose,
  onRename,
  onShare,
  onDelete,
}: {
  list: TodoList | null;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onShare: (list: TodoList) => void;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(list?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!list) return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-panel-2 p-3" role="dialog" aria-label={`Options for ${list.name}`}>
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="List name"
          className="min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-3 py-1.5 text-sm text-star focus:border-neon-cyan/60 focus:outline-none"
        />
        <button
          type="button"
          disabled={busy || !name.trim() || name.trim() === list.name}
          onClick={() => void run(() => onRename(name.trim()))}
          className="shrink-0 rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-1.5 text-xs font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Rename
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onShare(list)}
          className="flex-1 rounded-lg border border-neon-green/40 bg-neon-green/10 px-3 py-1.5 text-xs font-medium text-neon-green transition-colors hover:bg-neon-green/20"
        >
          Share this list…
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(onDelete)}
          className="flex-1 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Delete list
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-dim transition-colors hover:text-star"
        >
          Close
        </button>
      </div>
      {error !== null && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Share dialog                                                         */
/* ------------------------------------------------------------------ */

function ShareDialog({
  list,
  onClose,
  getShares,
  shareList,
  revokeShare,
}: {
  list: TodoList;
  onClose: () => void;
  getShares: (listId: string) => Promise<TodoShare[]>;
  shareList: (listId: string, email: string, permission?: "view" | "edit") => Promise<{ share: TodoShare; inviteUrl: string }>;
  revokeShare: (listId: string, shareId: string) => Promise<void>;
}) {
  const [shares, setShares] = useState<TodoShare[]>([]);
  const [loadingShares, setLoadingShares] = useState(true);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("edit");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getShares(list.id);
        if (!cancelled) setShares(s);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load sharing. Try again.");
      } finally {
        if (!cancelled) setLoadingShares(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getShares, list.id]);

  async function handleShare() {
    setError(null);
    setInviteUrl(null);
    setCopied(false);
    setBusy(true);
    try {
      const { share, inviteUrl: url } = await shareList(list.id, email.trim(), permission);
      setShares((prev) => [...prev, share]);
      setEmail("");
      setInviteUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't share that list. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(shareId: string) {
    setError(null);
    try {
      await revokeShare(list.id, shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that share. Try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Share ${list.name}`}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel-2 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-star">Share “{list.name}”</h3>
          <button type="button" onClick={onClose} aria-label="Close sharing" className="rounded-lg px-2 py-1 text-dim hover:text-star">
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-dim">
          They&apos;ll get an invite link. Everyone you invite can{" "}
          {permission === "edit" ? "add, check off, and assign tasks" : "follow along"} — the list
          owner stays in control and can remove anyone anytime.
        </p>

        <div className="mt-3 flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleShare();
            }}
            type="email"
            placeholder="their@email.com"
            aria-label="Email to share with"
            className="min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-3 py-2 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
          />
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value === "view" ? "view" : "edit")}
            aria-label="Permission"
            className="shrink-0 rounded-lg border border-line bg-black/30 px-2 py-2 text-sm text-star focus:border-neon-cyan/60 focus:outline-none"
          >
            <option value="edit">Can edit</option>
            <option value="view">View only</option>
          </select>
        </div>
        <button
          type="button"
          disabled={busy || !email.trim()}
          onClick={() => void handleShare()}
          className="mt-2 w-full rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Sending invite…" : "Send invite"}
        </button>

        {inviteUrl !== null && (
          <div className="mt-2 rounded-lg border border-neon-green/30 bg-neon-green/5 p-3">
            <p className="text-xs text-stardust">Invite ready — share this link directly:</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-[11px] text-neon-green">{inviteUrl}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteUrl).then(() => setCopied(true)).catch(() => setCopied(false));
                }}
                className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-stardust hover:text-star"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-dim">Shared with</p>
          {loadingShares ? (
            <p className="mt-2 text-xs text-dim">Loading…</p>
          ) : shares.length === 0 ? (
            <p className="mt-2 text-xs text-dim">Just you, for now.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {shares.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-lg border border-line bg-black/20 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-star">{s.email}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-dim">
                    {s.permission === "edit" ? "can edit" : "view only"}
                    {s.accepted ? "" : " · invited"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRevoke(s.id)}
                    aria-label={`Remove ${s.email}`}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-dim hover:bg-red-400/10 hover:text-red-300"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error !== null && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Google Tasks panel                                                   */
/* ------------------------------------------------------------------ */

interface TasksConnection {
  id: string;
  provider_account_email: string | null;
  status: string;
  granted_scopes: string[] | null;
  last_tasks_sync: string | null;
}

const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

function GoogleTasksPanel() {
  const [connections, setConnections] = useState<TasksConnection[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/calendar/connections", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { connections?: TasksConnection[] };
        if (!cancelled) {
          setConnections((body.connections ?? []).filter((c) => c.provider_account_email !== undefined));
        }
      } catch {
        // Panel stays in its "couldn't load" state; the list still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncNote(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/tasks/sync", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        needsReconsent?: boolean;
        results?: { connection: string; pulled: number; pushed: number; skipped?: string }[];
      } | null;
      if (!res.ok || !body?.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Google Tasks didn't sync. Your to-dos are safe — try again in a moment.",
        );
      }
      const pulled = (body.results ?? []).reduce((n, r) => n + r.pulled, 0);
      const pushed = (body.results ?? []).reduce((n, r) => n + r.pushed, 0);
      if (body.needsReconsent) {
        setSyncNote(
          "Your Google connection was made before Tasks sync existed — reconnect below to turn it on.",
        );
      } else {
        setSyncNote(`Synced ✓ — ${pulled} pulled from Google, ${pushed} pushed to Google.`);
      }
      // Refresh the panel's connection state.
      const conns = await fetch("/api/calendar/connections", { cache: "no-store" });
      if (conns.ok) {
        const b = (await conns.json()) as { connections?: TasksConnection[] };
        setConnections(b.connections ?? []);
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Google Tasks didn't sync. Try again in a moment.");
    } finally {
      setSyncing(false);
    }
  }

  const googleConns = (connections ?? []).filter(() => true);
  const tasksReady = googleConns.some((c) => (c.granted_scopes ?? []).includes(TASKS_SCOPE));

  return (
    <div className="rounded-2xl border border-line bg-panel-2/40 p-4" aria-label="Google Tasks sync">
      <p className="text-sm font-medium text-star">Google Tasks two-way sync</p>
      {connections === null ? (
        <p className="mt-1 text-xs text-dim">Checking your Google connections…</p>
      ) : googleConns.length === 0 ? (
        <div className="mt-1">
          <p className="text-xs leading-relaxed text-stardust">
            Connect your Google account to sync to-dos with Google Tasks — complete or edit on
            either side.
          </p>
          <a
            href="/api/calendar/connect"
            className="mt-2 inline-block rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-xs font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
          >
            Connect Google
          </a>
        </div>
      ) : !tasksReady ? (
        <div className="mt-1">
          <p className="text-xs leading-relaxed text-stardust">
            Your Google connection was made before Tasks sync existed. Reconnect once to add the
            Tasks permission — your calendar keeps working either way.
          </p>
          <a
            href="/api/calendar/connect"
            className="mt-2 inline-block rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-400/20"
          >
            Reconnect to enable Tasks sync
          </a>
        </div>
      ) : (
        <div className="mt-1">
          <p className="text-xs text-stardust">
            {googleConns
              .filter((c) => (c.granted_scopes ?? []).includes(TASKS_SCOPE))
              .map((c) =>
                c.last_tasks_sync
                  ? `Last synced ${new Date(c.last_tasks_sync).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                  : "Never synced yet",
              )
              .join(" · ")}
          </p>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void handleSync()}
            className="mt-2 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-xs font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {syncing ? "Syncing…" : "Sync with Google Tasks now"}
          </button>
        </div>
      )}
      {syncNote !== null && <p className="mt-2 text-xs text-neon-green">{syncNote}</p>}
      {syncError !== null && <p className="mt-2 text-xs text-red-400">{syncError}</p>}
    </div>
  );
}
