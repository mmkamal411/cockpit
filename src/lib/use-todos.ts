"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { newId, readLocal, writeLocal } from "./local-store";
import { nextOccurrence } from "./recurrence.ts";

/**
 * useTodos — the single source of truth for the pilot's to-do lists.
 *
 * Persistence model (Supabase-first with offline queue):
 * - Every mutation is applied locally first (optimistic), persisted to
 *   localStorage, and queued as a pending op. The queue is ALWAYS written,
 *   even when signed out — signed-out work uploads on the next sign-in.
 * - The client generates UUIDs (crypto.randomUUID) and POST sends them, so
 *   a retried POST is idempotent and re-flushes never duplicate.
 * - On sign-in the queue uploads first, then client and server merge by
 *   `updated_at` (last-write-wins). Deletes are `deleted_at` tombstones, so
 *   a delete on one device doesn't get resurrected by another.
 * - Lists come from /api/todo-lists (own + shared-with-me). Sharing is
 *   managed through /api/todo-lists/[id]/shares.
 *
 * Field mapping: text <-> title, createdAt <-> created_at, dueAt <-> due_at.
 */

export type TodoPriority = "p1" | "p2" | "p3" | "p4";

export interface TodoItem {
  id: string;
  pilotId?: string | null;
  text: string;
  done: boolean;
  createdAt: number; // epoch ms, maps to DB `created_at`
  completedAt?: number | null;
  /** Last-write-wins marker (epoch ms). Every local mutation bumps it. */
  updatedAt: number;
  /** Soft-delete tombstone (epoch ms). Set instead of removing the row. */
  deletedAt?: number | null;
  dueAt?: number | null;
  priority?: TodoPriority | null;
  labels?: string[];
  notes?: string | null;
  source?: "manual" | "calendar" | "mail";
  listId?: string | null;
  parentTodoId?: string | null;
  section?: string | null;
  assignedToPilotId?: string | null;
  recurrence?: string | null;
  reminderAt?: number | null;
  googleTaskId?: string | null;
  googleTasklistId?: string | null;
}

export interface TodoList {
  id: string;
  name: string;
  color?: string | null;
  position: number;
  /** True when the pilot owns the list (false = shared with them). */
  mine: boolean;
  permission: "view" | "edit";
}

export interface TodoShare {
  id: string;
  email: string;
  permission: "view" | "edit";
  accepted: boolean;
  pilotId: string | null;
  created_at: string;
}

export interface TodoPerson {
  id: string;
  name: string;
}

export interface BreakdownSubtask {
  text: string;
  dueAt?: number | null;
}

export interface AddTodoOpts {
  dueAt?: number | null;
  /** True when the pilot typed an explicit time (drives reminder default). */
  timed?: boolean;
  priority?: TodoPriority | null;
  labels?: string[];
  notes?: string | null;
  listId?: string | null;
  parentTodoId?: string | null;
  section?: string | null;
  assignedToPilotId?: string | null;
  recurrence?: string | null;
  reminderAt?: number | null;
  /** Skip the automatic reminder default (the pilot manages it manually). */
  noAutoReminder?: boolean;
}

export interface UseTodos {
  /** Non-deleted todos across all lists (own + shared). */
  todos: TodoItem[];
  lists: TodoList[];
  /** Me + collaborators on the currently loaded shares (for assignees). */
  people: TodoPerson[];
  myPilotId: string | null;
  loading: boolean;
  /** null = unknown yet, true/false = session state. */
  signedIn: boolean | null;
  /** Plain-English reason the last cloud sync failed; null when healthy. */
  syncError: string | null;
  retrySync: () => Promise<void>;
  addTodo: (text: string, opts?: AddTodoOpts) => Promise<TodoItem>;
  toggleTodo: (id: string) => Promise<void>;
  updateTodo: (id: string, patch: Partial<TodoItem>) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  createList: (name: string, color?: string | null) => Promise<TodoList>;
  updateList: (id: string, patch: { name?: string; color?: string | null }) => Promise<void>;
  deleteList: (id: string) => Promise<void>;
  getShares: (listId: string) => Promise<TodoShare[]>;
  shareList: (
    listId: string,
    email: string,
    permission?: "view" | "edit",
  ) => Promise<{ share: TodoShare; inviteUrl: string }>;
  revokeShare: (listId: string, shareId: string) => Promise<void>;
  /** Crystal proposes dated sub-tasks for a todo; they are created as sub-tasks. */
  requestBreakdown: (todoId: string) => Promise<TodoItem[]>;
}

const TODOS_KEY = "cockpit.todos.v2";
const LEGACY_TODOS_KEY = "cockpit.todos";
const LISTS_KEY = "cockpit.todoLists";
const PENDING_KEY = "cockpit.todos.pending";

type PendingOp =
  | { kind: "add"; item: TodoItem }
  | { kind: "update"; id: string; body: TodoBody }
  | { kind: "delete"; id: string };

/** API wire body (client field names — the routes map them to columns). */
interface TodoBody {
  text?: string;
  dueAt?: number | null;
  done?: boolean;
  priority?: TodoPriority | null;
  labels?: string[];
  notes?: string | null;
  listId?: string | null;
  parentTodoId?: string | null;
  section?: string | null;
  assignedToPilotId?: string | null;
  recurrence?: string | null;
  reminderAt?: number | null;
}

/** Default reminder policy: 30 min before timed todos, 9am that day for
 *  date-only ones. Pass timed=false to force the morning default. */
export function defaultReminderAt(dueAt: number | null | undefined, timed: boolean): number | null {
  if (dueAt == null) return null;
  if (timed) return dueAt - 30 * 60 * 1000;
  const d = new Date(dueAt);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

/** Server row (camelCase via rowToItem) -> TodoItem. */
function normalizeItem(raw: unknown): TodoItem {
  const r = (raw ?? {}) as Partial<TodoItem> & { pilotId?: string | null };
  const p = r.priority;
  return {
    id: typeof r.id === "string" ? r.id : newId(),
    pilotId: typeof r.pilotId === "string" ? r.pilotId : null,
    text: typeof r.text === "string" ? r.text : "",
    done: r.done === true,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    completedAt: typeof r.completedAt === "number" ? r.completedAt : null,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
    deletedAt: typeof r.deletedAt === "number" ? r.deletedAt : null,
    dueAt: typeof r.dueAt === "number" ? r.dueAt : null,
    priority: p === "p1" || p === "p2" || p === "p3" || p === "p4" ? p : null,
    labels: Array.isArray(r.labels) ? r.labels.filter((l): l is string => typeof l === "string") : [],
    notes: typeof r.notes === "string" ? r.notes : null,
    source: r.source === "calendar" || r.source === "mail" ? r.source : "manual",
    listId: typeof r.listId === "string" ? r.listId : null,
    parentTodoId: typeof r.parentTodoId === "string" ? r.parentTodoId : null,
    section: typeof r.section === "string" ? r.section : null,
    assignedToPilotId: typeof r.assignedToPilotId === "string" ? r.assignedToPilotId : null,
    recurrence: typeof r.recurrence === "string" ? r.recurrence : null,
    reminderAt: typeof r.reminderAt === "number" ? r.reminderAt : null,
    googleTaskId: typeof r.googleTaskId === "string" ? r.googleTaskId : null,
    googleTasklistId: typeof r.googleTasklistId === "string" ? r.googleTasklistId : null,
  };
}

/** Client item -> API request body. */
function itemToBody(item: TodoItem): TodoBody {
  return {
    text: item.text,
    dueAt: item.dueAt ?? null,
    done: item.done,
    priority: item.priority ?? null,
    labels: item.labels ?? [],
    notes: item.notes ?? null,
    listId: item.listId ?? null,
    parentTodoId: item.parentTodoId ?? null,
    section: item.section ?? null,
    assignedToPilotId: item.assignedToPilotId ?? null,
    recurrence: item.recurrence ?? null,
    reminderAt: item.reminderAt ?? null,
  };
}

/** API wire body -> partial TodoItem (for folding updates into queued adds). */
function bodyToPatch(body: TodoBody): Partial<TodoItem> {
  const patch: Partial<TodoItem> = {};
  if (body.text !== undefined) patch.text = body.text;
  if (body.dueAt !== undefined) patch.dueAt = body.dueAt;
  if (body.done !== undefined) patch.done = body.done;
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.labels !== undefined) patch.labels = body.labels;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.listId !== undefined) patch.listId = body.listId;
  if (body.parentTodoId !== undefined) patch.parentTodoId = body.parentTodoId;
  if (body.section !== undefined) patch.section = body.section;
  if (body.assignedToPilotId !== undefined) patch.assignedToPilotId = body.assignedToPilotId;
  if (body.recurrence !== undefined) patch.recurrence = body.recurrence;
  if (body.reminderAt !== undefined) patch.reminderAt = body.reminderAt;
  return patch;
}

/** Patch -> API request body (only the fields the caller set). */
function patchToBody(patch: Partial<TodoItem>): TodoBody {
  const body: TodoBody = {};
  if (typeof patch.text === "string") body.text = patch.text;
  if (typeof patch.done === "boolean") body.done = patch.done;
  if (typeof patch.dueAt === "number" || patch.dueAt === null) body.dueAt = patch.dueAt;
  if (
    patch.priority === "p1" ||
    patch.priority === "p2" ||
    patch.priority === "p3" ||
    patch.priority === "p4" ||
    patch.priority === null
  ) {
    body.priority = patch.priority;
  }
  if (Array.isArray(patch.labels)) {
    body.labels = patch.labels.filter((l): l is string => typeof l === "string");
  }
  if (typeof patch.notes === "string" || patch.notes === null) body.notes = patch.notes;
  if (typeof patch.listId === "string" || patch.listId === null) body.listId = patch.listId;
  if (typeof patch.parentTodoId === "string" || patch.parentTodoId === null) {
    body.parentTodoId = patch.parentTodoId;
  }
  if (typeof patch.section === "string" || patch.section === null) body.section = patch.section;
  if (typeof patch.assignedToPilotId === "string" || patch.assignedToPilotId === null) {
    body.assignedToPilotId = patch.assignedToPilotId;
  }
  if (typeof patch.recurrence === "string" || patch.recurrence === null) {
    body.recurrence = patch.recurrence;
  }
  if (typeof patch.reminderAt === "number" || patch.reminderAt === null) {
    body.reminderAt = patch.reminderAt;
  }
  return body;
}

function normalizeList(raw: unknown): TodoList {
  const r = (raw ?? {}) as Partial<TodoList>;
  return {
    id: typeof r.id === "string" ? r.id : newId(),
    name: typeof r.name === "string" ? r.name : "List",
    color: typeof r.color === "string" ? r.color : null,
    position: typeof r.position === "number" ? r.position : 0,
    mine: r.mine !== false,
    permission: r.permission === "view" ? "view" : "edit",
  };
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

const SYNC_DOWN =
  "Your to-dos aren't syncing to the cloud right now. " +
  "Everything is still saved on this device and will sync on its own once the connection is back.";

/**
 * Merge local and server items after the queue uploads.
 * Last-write-wins on updatedAt; tombstones beat live rows on either side
 * (a delete is always deliberate — never resurrect). Returns the merged
 * list plus local items that are newer than the server but somehow not in
 * the queue (the queue was lost) so the caller can re-queue them: `add`
 * for rows the server never saw, `update` for rows it did.
 */
function mergeItems(
  local: TodoItem[],
  server: TodoItem[],
  queue: PendingOp[],
): { items: TodoItem[]; requeueAdd: TodoItem[]; requeueUpdate: TodoItem[] } {
  const serverById = new Map(server.map((s) => [s.id, s]));
  const localById = new Map(local.map((l) => [l.id, l]));
  const queuedIds = new Set(
    queue.map((op) => (op.kind === "add" ? op.item.id : op.id)),
  );
  const merged: TodoItem[] = [];
  const requeueAdd: TodoItem[] = [];
  const requeueUpdate: TodoItem[] = [];

  for (const l of local) {
    const s = serverById.get(l.id);
    if (!s) {
      merged.push(l);
      if (!l.deletedAt && !queuedIds.has(l.id)) {
        // Not on the server and nothing queued — re-queue the add so the
        // row isn't stranded local-only.
        requeueAdd.push(l);
      }
      continue;
    }
    if (s.deletedAt || l.deletedAt) {
      // A delete on either side wins — never resurrect.
      continue;
    }
    if (s.updatedAt > l.updatedAt) {
      merged.push(s);
    } else {
      merged.push(l);
      if (l.updatedAt > s.updatedAt && !queuedIds.has(l.id)) requeueUpdate.push(l);
    }
  }
  for (const s of server) {
    if (!localById.has(s.id) && !s.deletedAt) merged.push(s);
  }
  return { items: merged, requeueAdd, requeueUpdate };
}

export function useTodos(): UseTodos {
  // allItems includes local tombstones (deletedAt set) so merges and the
  // queue can reconcile them; `todos` exposes the visible ones.
  const [allItems, setAllItems] = useState<TodoItem[]>(() => {
    const v2 = readLocal<unknown[]>(TODOS_KEY, []);
    if (v2.length > 0) return v2.map(normalizeItem);
    // One-time upgrade from the v1 key — after this the v2 key owns it.
    const legacy = readLocal<unknown[]>(LEGACY_TODOS_KEY, []).map(normalizeItem);
    if (legacy.length > 0) writeLocal(TODOS_KEY, legacy);
    return legacy;
  });
  const [lists, setLists] = useState<TodoList[]>(() =>
    readLocal<unknown[]>(LISTS_KEY, []).map(normalizeList),
  );
  const [people, setPeople] = useState<TodoPerson[]>([]);
  const [myPilotId, setMyPilotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const itemsRef = useRef(allItems);
  const listsRef = useRef(lists);
  const signedInRef = useRef<boolean | null>(null);
  const flushingRef = useRef(false);

  const todos = useMemo(() => allItems.filter((t) => !t.deletedAt), [allItems]);

  const persist = useCallback((next: TodoItem[]) => {
    itemsRef.current = next;
    setAllItems(next);
    writeLocal(TODOS_KEY, next);
  }, []);

  const persistLists = useCallback((next: TodoList[]) => {
    listsRef.current = next;
    setLists(next);
    writeLocal(LISTS_KEY, next);
  }, []);

  const readQueue = useCallback(() => readLocal<PendingOp[]>(PENDING_KEY, []), []);
  const writeQueue = useCallback((queue: PendingOp[]) => writeLocal(PENDING_KEY, queue), []);

  /** Adopt the server row's canonical fields after a successful write. */
  const adoptServerRow = useCallback(
    (id: string, row: unknown) => {
      const server = normalizeItem(row);
      persist(
        itemsRef.current.map((t) =>
          t.id === id
            ? {
                ...t,
                listId: server.listId ?? t.listId,
                updatedAt: server.updatedAt,
                createdAt: server.createdAt,
                completedAt: server.completedAt,
                deletedAt: server.deletedAt,
              }
            : t,
        ),
      );
    },
    [persist],
  );

  /** Drain the pending queue in order. Stops on the first failure or 401.
   *  Runs when signed in; signed-out writes wait in localStorage. */
  const flush = useCallback(async () => {
    if (flushingRef.current || signedInRef.current === false) return;
    flushingRef.current = true;
    try {
      let queue = readQueue();
      while (queue.length > 0) {
        const op = queue[0];
        let res: Response;
        try {
          if (op.kind === "add") {
            // Client-generated UUID: a retried POST is idempotent server-side.
            res = await api("/api/todos", {
              method: "POST",
              body: JSON.stringify({ ...itemToBody(op.item), id: op.item.id }),
            });
          } else if (op.kind === "update") {
            res = await api(`/api/todos/${encodeURIComponent(op.id)}`, {
              method: "PUT",
              body: JSON.stringify(op.body),
            });
          } else {
            res = await api(`/api/todos/${encodeURIComponent(op.id)}`, { method: "DELETE" });
          }
        } catch {
          break; // Network down — keep the queue, retry later.
        }
        if (res.status === 401) {
          signedInRef.current = false;
          setSignedIn(false);
          break;
        }
        if (res.status === 404 && op.kind !== "add") {
          // Row already gone server-side — the update/delete had its effect.
          queue = queue.slice(1);
          writeQueue(queue);
          continue;
        }
        if (res.status === 400) {
          // Malformed op — it will never succeed, so drop it and keep going.
          queue = queue.slice(1);
          writeQueue(queue);
          continue;
        }
        if (!res.ok) {
          setSyncError(SYNC_DOWN);
          break;
        }
        if (op.kind === "add" || op.kind === "update") {
          try {
            const row = (await res.json()) as unknown;
            adoptServerRow(op.kind === "add" ? op.item.id : op.id, row);
          } catch {
            // Body unreadable — the write still landed; drop the op.
          }
        }
        if (op.kind === "delete") {
          // The server holds the tombstone now — the local one can go.
          persist(itemsRef.current.filter((t) => t.id !== op.id));
        }
        queue = queue.slice(1);
        writeQueue(queue);
      }
      if (queue.length === 0) setSyncError(null);
    } finally {
      flushingRef.current = false;
    }
  }, [readQueue, writeQueue, adoptServerRow, persist]);

  /**
   * Queue a write. The queue is ALWAYS persisted — signed-out pilots keep
   * working and their changes upload on the next sign-in. Nothing here
   * blocks the list: failures stay queued with a plain-English banner.
   */
  const enqueue = useCallback(
    (op: PendingOp) => {
      let queue = readQueue();
      if (op.kind === "delete") {
        // A delete supersedes any queued add/update for the same id.
        queue = queue.filter(
          (q) =>
            !(
              (q.kind === "add" && q.item.id === op.id) ||
              (q.kind === "update" && q.id === op.id)
            ),
        );
      }
      if (op.kind === "update") {
        // Fold into a queued add for the same id (not uploaded yet).
        const addIdx = queue.findIndex((q) => q.kind === "add" && q.item.id === op.id);
        if (addIdx >= 0) {
          const addOp = queue[addIdx];
          if (addOp.kind === "add") {
            queue = [
              ...queue.slice(0, addIdx),
              {
                kind: "add",
                item: { ...addOp.item, ...bodyToPatch(op.body), updatedAt: Date.now() },
              },
              ...queue.slice(addIdx + 1),
            ];
            writeQueue(queue);
            void flush();
            return;
          }
        }
      }
      writeQueue([...queue, op]);
      void flush();
    },
    [readQueue, writeQueue, flush],
  );

  // --- Initial load: upload pending ops first, then merge by updated_at. ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/todos");
        if (cancelled) return;
        if (res.status === 401) {
          signedInRef.current = false;
          setSignedIn(false);
        } else if (res.ok) {
          signedInRef.current = true;
          setSignedIn(true);
          // Pending ops upload first — then the merge sees both sides.
          await flush();

          const rowsRes = await api("/api/todos");
          if (cancelled) return;
          if (rowsRes.ok) {
            const serverItems = ((await rowsRes.json()) as unknown[]).map(normalizeItem);
            if (!cancelled) {
              const merged = mergeItems(itemsRef.current, serverItems, readQueue());
              persist(merged.items);
              for (const item of merged.requeueAdd) {
                enqueue({ kind: "add", item });
              }
              for (const item of merged.requeueUpdate) {
                enqueue({ kind: "update", id: item.id, body: itemToBody(item) });
              }
            }
          }

          try {
            const listsRes = await api("/api/todo-lists");
            if (listsRes.ok && !cancelled) {
              const body = (await listsRes.json()) as {
                lists?: unknown[];
                me?: { id?: string; email?: string | null };
              };
              persistLists((body.lists ?? []).map(normalizeList));
              if (typeof body.me?.id === "string") {
                setMyPilotId(body.me.id);
                setPeople([{ id: body.me.id, name: "Me" }]);
              }
            }
          } catch {
            // Lists failing never blocks the todos themselves.
          }
          await flush();
        } else {
          setSyncError(
            "Couldn't reach your cloud list. Showing what's saved on this device — " +
              "it will reconnect on its own.",
          );
        }
      } catch {
        // Offline or unreachable — the local list stays on screen.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enqueue, flush, persist, persistLists, readQueue]);

  const defaultListId = useCallback((): string | null => {
    const own = listsRef.current.filter((l) => l.mine);
    const pool = own.length > 0 ? own : listsRef.current;
    const sorted = [...pool].sort((a, b) => a.position - b.position);
    return sorted[0]?.id ?? null;
  }, []);

  const addTodo = useCallback(
    async (text: string, opts: AddTodoOpts = {}): Promise<TodoItem> => {
      const clean = text.trim();
      if (!clean) throw new Error("A to-do needs a few words of text.");
      const now = Date.now();
      const dueAt = opts.dueAt ?? null;
      const item = normalizeItem({
        ...opts,
        id: newId(),
        text: clean,
        done: false,
        createdAt: now,
        updatedAt: now,
        source: "manual",
        listId: opts.listId ?? defaultListId() ?? "local-default",
        reminderAt:
          opts.reminderAt !== undefined
            ? opts.reminderAt
            : opts.noAutoReminder
              ? null
              : defaultReminderAt(dueAt, opts.timed ?? false),
      });
      persist([item, ...itemsRef.current]);
      enqueue({ kind: "add", item });
      await flush();
      return itemsRef.current.find((t) => t.id === item.id) ?? item;
    },
    [persist, enqueue, flush, defaultListId],
  );

  const toggleTodo = useCallback(
    async (id: string): Promise<void> => {
      const current = itemsRef.current.find((t) => t.id === id);
      if (!current || current.deletedAt) return;
      const done = !current.done;
      const now = Date.now();
      persist(
        itemsRef.current.map((t) =>
          t.id === id
            ? { ...t, done, completedAt: done ? now : null, updatedAt: now }
            : t,
        ),
      );
      enqueue({ kind: "update", id, body: { done } });

      // Recurrence forward-roll: completing a repeating todo schedules the
      // next occurrence as a fresh todo; the completed one stays done.
      if (done && current.recurrence) {
        const next = nextOccurrence(current.recurrence, current.dueAt ?? now);
        if (next !== null) {
          await addTodo(current.text, {
            dueAt: next,
            timed: current.dueAt != null && current.reminderAt != null && current.reminderAt !== defaultReminderAt(current.dueAt, false),
            priority: current.priority,
            labels: current.labels,
            notes: current.notes,
            listId: current.listId,
            section: current.section,
            assignedToPilotId: current.assignedToPilotId,
            recurrence: current.recurrence,
          });
        }
      }
    },
    [persist, enqueue, addTodo],
  );

  const updateTodo = useCallback(
    async (id: string, patch: Partial<TodoItem>): Promise<void> => {
      if (!itemsRef.current.some((t) => t.id === id)) return;
      const clean: Partial<TodoItem> = { ...patch };
      delete clean.id;
      delete clean.createdAt;
      delete clean.updatedAt;
      delete clean.deletedAt;
      if (typeof clean.text === "string") {
        clean.text = clean.text.trim();
        if (clean.text === "") return;
      }
      const body = patchToBody(clean);
      const now = Date.now();
      persist(
        itemsRef.current.map((t) => (t.id === id ? { ...t, ...clean, updatedAt: now } : t)),
      );
      if (Object.keys(body).length > 0) enqueue({ kind: "update", id, body });
    },
    [persist, enqueue],
  );

  const deleteTodo = useCallback(
    async (id: string): Promise<void> => {
      const current = itemsRef.current.find((t) => t.id === id);
      if (!current || current.deletedAt) return;
      // Tombstone locally; the DELETE op carries it to the server.
      persist(
        itemsRef.current.map((t) =>
          t.id === id ? { ...t, deletedAt: Date.now(), updatedAt: Date.now() } : t,
        ),
      );
      enqueue({ kind: "delete", id });
    },
    [persist, enqueue],
  );

  /** Manual retry of the background sync — clears the error when it succeeds. */
  const retrySync = useCallback(async () => {
    setSyncError(null);
    await flush();
  }, [flush]);

  // --- Lists ---
  const requireSignedIn = useCallback(() => {
    if (signedInRef.current === false) {
      throw new Error("Sign in to manage lists — your to-dos still work on this device.");
    }
  }, []);

  const createList = useCallback(
    async (name: string, color?: string | null): Promise<TodoList> => {
      requireSignedIn();
      const res = await api("/api/todo-lists", {
        method: "POST",
        body: JSON.stringify({ name, color: color ?? null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't create that list. Try again.",
        );
      }
      const { list } = (await res.json()) as { list: unknown };
      const created = normalizeList(list);
      persistLists([...listsRef.current, created]);
      return created;
    },
    [persistLists, requireSignedIn],
  );

  const updateList = useCallback(
    async (id: string, patch: { name?: string; color?: string | null }): Promise<void> => {
      requireSignedIn();
      const res = await api(`/api/todo-lists/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't update that list. Try again.",
        );
      }
      const { list } = (await res.json()) as { list: unknown };
      const updated = normalizeList({ ...((list ?? {}) as Record<string, unknown>), mine: true });
      persistLists(listsRef.current.map((l) => (l.id === id ? { ...updated, permission: l.permission } : l)));
    },
    [persistLists, requireSignedIn],
  );

  const deleteList = useCallback(
    async (id: string): Promise<void> => {
      requireSignedIn();
      const res = await api(`/api/todo-lists/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't delete that list. Try again.",
        );
      }
      persistLists(listsRef.current.filter((l) => l.id !== id));
      // The server cascades the list's todos; drop the local copies too.
      persist(itemsRef.current.filter((t) => t.listId !== id));
    },
    [persistLists, persist, requireSignedIn],
  );

  // --- Sharing ---
  const getShares = useCallback(
    async (listId: string): Promise<TodoShare[]> => {
      requireSignedIn();
      const res = await api(`/api/todo-lists/${encodeURIComponent(listId)}/shares`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't load sharing. Try again.",
        );
      }
      const { shares } = (await res.json()) as { shares?: unknown[] };
      const normalized = ((shares ?? []) as Partial<TodoShare>[]).map((s) => ({
        id: typeof s.id === "string" ? s.id : "",
        email: typeof s.email === "string" ? s.email : "",
        permission: s.permission === "view" ? ("view" as const) : ("edit" as const),
        accepted: s.accepted === true,
        pilotId: typeof s.pilotId === "string" ? s.pilotId : null,
        created_at: typeof s.created_at === "string" ? s.created_at : "",
      }));
      // Collaborators become assignable people.
      setPeople((prev) => {
        const next = [...prev];
        for (const s of normalized) {
          if (s.pilotId && !next.some((p) => p.id === s.pilotId)) {
            const handle = s.email.split("@")[0] || s.email;
            const name = handle.charAt(0).toUpperCase() + handle.slice(1);
            next.push({ id: s.pilotId, name });
          }
        }
        return next;
      });
      return normalized;
    },
    [requireSignedIn],
  );

  const shareList = useCallback(
    async (
      listId: string,
      email: string,
      permission: "view" | "edit" = "edit",
    ): Promise<{ share: TodoShare; inviteUrl: string }> => {
      requireSignedIn();
      const res = await api(`/api/todo-lists/${encodeURIComponent(listId)}/shares`, {
        method: "POST",
        body: JSON.stringify({ email, permission }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't share that list. Try again.",
        );
      }
      const { share, inviteUrl } = (await res.json()) as {
        share: { id: string; email: string; permission: "view" | "edit"; accepted: boolean };
        inviteUrl: string;
      };
      return {
        share: {
          id: share.id,
          email: share.email,
          permission: share.permission,
          accepted: share.accepted,
          pilotId: null,
          created_at: new Date().toISOString(),
        },
        inviteUrl,
      };
    },
    [requireSignedIn],
  );

  const revokeShare = useCallback(
    async (listId: string, shareId: string): Promise<void> => {
      requireSignedIn();
      const res = await api(
        `/api/todo-lists/${encodeURIComponent(listId)}/shares/${encodeURIComponent(shareId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't remove that share. Try again.",
        );
      }
    },
    [requireSignedIn],
  );

  // --- Crystal breakdown ---
  const requestBreakdown = useCallback(
    async (todoId: string): Promise<TodoItem[]> => {
      const parent = itemsRef.current.find((t) => t.id === todoId);
      if (!parent) throw new Error("That to-do is gone — it may have been deleted.");
      const res = await api("/api/todos/breakdown", {
        method: "POST",
        body: JSON.stringify({ todoId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Crystal couldn't break that down right now. Try again in a moment.",
        );
      }
      const { subtasks } = (await res.json()) as { subtasks?: BreakdownSubtask[] };
      const created: TodoItem[] = [];
      for (const sub of subtasks ?? []) {
        const text = sub.text.trim().slice(0, 500);
        if (!text) continue;
        const item = await addTodo(text, {
          parentTodoId: parent.id,
          listId: parent.listId,
          dueAt: typeof sub.dueAt === "number" ? sub.dueAt : null,
          priority: parent.priority,
        });
        created.push(item);
      }
      return created;
    },
    [addTodo],
  );

  return {
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
  };
}
