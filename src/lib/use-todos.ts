"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { newId, readLocal, writeLocal } from "./local-store";

/**
 * useTodos — the single source of truth for the pilot's to-do list.
 *
 * The list lives in Supabase (`todos` table) when the pilot is signed in
 * and falls back to device-local storage otherwise. Every change is
 * applied to local state immediately (optimistic), persisted to
 * localStorage as a backup, and synced to /api/todos in the background.
 * Failed syncs sit in a small retry queue instead of crashing the UI.
 *
 * Field mapping: text <-> title, createdAt <-> created_at, dueAt <-> due_at.
 */

export interface TodoItem {
  id: string;
  text: string; // maps to DB `title`
  done: boolean;
  createdAt: number; // epoch ms, maps to DB `created_at`
  dueAt?: number | null; // epoch ms, maps to DB `due_at`
  priority?: "low" | "medium" | "high" | null;
  labels?: string[];
  notes?: string | null;
  source?: "manual" | "calendar" | "mail";
}

export interface UseTodos {
  todos: TodoItem[];
  loading: boolean;
  addTodo(text: string, opts?: Partial<TodoItem>): Promise<TodoItem>;
  toggleTodo(id: string): Promise<void>;
  updateTodo(id: string, patch: Partial<TodoItem>): Promise<void>;
  deleteTodo(id: string): Promise<void>;
}

const TODOS_KEY = "cockpit.todos";
const IMPORTED_KEY = "cockpit.todos.imported";
const PENDING_KEY = "cockpit.todos.pending";
const IDMAP_KEY = "cockpit.todos.idmap";

type PendingOp =
  | { kind: "add"; localId: string; body: TodoBody }
  | { kind: "update"; localId: string; body: TodoBody }
  | { kind: "delete"; localId: string };

interface TodoBody {
  text?: string;
  dueAt?: number | null;
  done?: boolean;
  priority?: "low" | "medium" | "high" | null;
  labels?: string[];
  notes?: string | null;
}

interface TodoRow {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
  due_at: string | null;
  priority: "low" | "medium" | "high" | null;
  labels: string[] | null;
  notes: string | null;
  source: "manual" | "calendar" | "mail";
}

function rowToItem(row: TodoRow): TodoItem {
  return {
    id: row.id,
    text: row.title,
    done: row.done,
    createdAt: Date.parse(row.created_at) || Date.now(),
    dueAt: row.due_at ? Date.parse(row.due_at) : null,
    priority: row.priority,
    labels: row.labels ?? [],
    notes: row.notes,
    source: row.source,
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
  };
}

/** Patch -> API request body (only the fields the caller set). */
function patchToBody(patch: Partial<TodoItem>): TodoBody {
  const body: TodoBody = {};
  if (typeof patch.text === "string") body.text = patch.text;
  if (typeof patch.done === "boolean") body.done = patch.done;
  if (typeof patch.dueAt === "number" || patch.dueAt === null) body.dueAt = patch.dueAt;
  if (patch.priority === "low" || patch.priority === "medium" || patch.priority === "high" || patch.priority === null) {
    body.priority = patch.priority;
  }
  if (Array.isArray(patch.labels)) body.labels = patch.labels.filter((l): l is string => typeof l === "string");
  if (typeof patch.notes === "string" || patch.notes === null) body.notes = patch.notes;
  return body;
}

/** Fill in defaults so items read from localStorage always match the shape. */
function normalizeItem(raw: unknown): TodoItem {
  const r = (raw ?? {}) as Partial<TodoItem>;
  return {
    id: typeof r.id === "string" ? r.id : newId(),
    text: typeof r.text === "string" ? r.text : "",
    done: r.done === true,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    dueAt: typeof r.dueAt === "number" ? r.dueAt : null,
    priority:
      r.priority === "low" || r.priority === "medium" || r.priority === "high" ? r.priority : null,
    labels: Array.isArray(r.labels) ? r.labels.filter((l): l is string => typeof l === "string") : [],
    notes: typeof r.notes === "string" ? r.notes : null,
    source: r.source === "calendar" || r.source === "mail" ? r.source : "manual",
  };
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

export function useTodos(): UseTodos {
  const [todos, setTodos] = useState<TodoItem[]>(() =>
    readLocal<unknown[]>(TODOS_KEY, []).map(normalizeItem),
  );
  const [loading, setLoading] = useState(true);

  const todosRef = useRef(todos);
  const signedInRef = useRef<boolean | null>(null);
  const idMapRef = useRef<Map<string, string>>(
    new Map(Object.entries(readLocal<Record<string, string>>(IDMAP_KEY, {}))),
  );
  const flushingRef = useRef(false);

  const persist = useCallback((next: TodoItem[]) => {
    todosRef.current = next;
    setTodos(next);
    writeLocal(TODOS_KEY, next);
  }, []);

  /** Swap a temporary local id for the id Supabase assigned. */
  const rememberId = useCallback(
    (localId: string, serverId: string) => {
      if (localId === serverId) return;
      idMapRef.current.set(localId, serverId);
      writeLocal(IDMAP_KEY, Object.fromEntries(idMapRef.current));
      persist(todosRef.current.map((t) => (t.id === localId ? { ...t, id: serverId } : t)));
    },
    [persist],
  );

  const resolveId = useCallback(
    (localId: string) => idMapRef.current.get(localId) ?? localId,
    [],
  );

  const readQueue = useCallback(() => readLocal<PendingOp[]>(PENDING_KEY, []), []);
  const writeQueue = useCallback((queue: PendingOp[]) => writeLocal(PENDING_KEY, queue), []);

  /** Drain the retry queue in order. Stops on the first failure or 401. */
  const flush = useCallback(async () => {
    if (flushingRef.current || signedInRef.current === false) return;
    flushingRef.current = true;
    try {
      let queue = readQueue();
      while (queue.length > 0) {
        const op = queue[0];
        const serverId = resolveId(op.localId);
        let res: Response;
        try {
          if (op.kind === "add") {
            res = await api("/api/todos", { method: "POST", body: JSON.stringify(op.body) });
          } else if (op.kind === "update") {
            res = await api(`/api/todos/${encodeURIComponent(serverId)}`, {
              method: "PUT",
              body: JSON.stringify(op.body),
            });
          } else {
            res = await api(`/api/todos/${encodeURIComponent(serverId)}`, { method: "DELETE" });
          }
        } catch {
          break; // Network down — keep the queue, retry later.
        }
        if (res.status === 401) {
          signedInRef.current = false;
          break;
        }
        // A 404 on update/delete means the row is already gone server-side.
        if (!res.ok && !(res.status === 404 && op.kind !== "add")) break;
        if (op.kind === "add" && res.ok) {
          try {
            const row = (await res.json()) as { id?: string };
            if (typeof row.id === "string") rememberId(op.localId, row.id);
          } catch {
            // Body unreadable — the row still exists server-side; drop the op.
          }
        }
        queue = queue.slice(1);
        writeQueue(queue);
      }
    } finally {
      flushingRef.current = false;
    }
  }, [readQueue, writeQueue, resolveId, rememberId]);

  const enqueue = useCallback(
    (op: PendingOp) => {
      if (signedInRef.current === false) return;
      writeQueue([...readQueue(), op]);
      void flush();
    },
    [readQueue, writeQueue, flush],
  );

  // --- Initial load: server first, local as the silent fallback. ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/todos");
        if (cancelled) return;
        if (res.status === 401) {
          signedInRef.current = false;
        } else if (res.ok) {
          signedInRef.current = true;
          const rows = (await res.json()) as TodoRow[];
          const serverItems = rows.map(rowToItem);
          const local = readLocal<unknown[]>(TODOS_KEY, []).map(normalizeItem);

          if (!readLocal(IMPORTED_KEY, false) && local.length > 0 && serverItems.length === 0) {
            // One-time import: the device list moves to the cloud.
            const posted: TodoItem[] = [];
            for (const item of local) {
              if (cancelled) return;
              try {
                const r = await api("/api/todos", {
                  method: "POST",
                  body: JSON.stringify(itemToBody(item)),
                });
                if (!r.ok) break;
                const row = (await r.json()) as { id?: string };
                posted.push(typeof row.id === "string" ? { ...item, id: row.id } : item);
              } catch {
                break;
              }
            }
            const remaining = local.slice(posted.length);
            if (posted.length === local.length) {
              writeLocal(IMPORTED_KEY, true);
            } else {
              for (const item of remaining) {
                enqueue({ kind: "add", localId: item.id, body: itemToBody(item) });
              }
            }
            if (!cancelled) persist([...posted, ...remaining]);
          } else {
            // Dedupe: queued adds that already exist server-side are done.
            let queue = readQueue();
            const createdById = new Map(
              todosRef.current.map((t) => [t.id, t.createdAt] as const),
            );
            const dropped = new Set<string>();
            for (const op of queue) {
              if (op.kind !== "add") continue;
              const createdAt = createdById.get(op.localId);
              const match = serverItems.find(
                (s) => s.text === op.body.text && s.createdAt === createdAt,
              );
              if (match) {
                dropped.add(op.localId);
                rememberId(op.localId, match.id);
              }
            }
            if (dropped.size > 0) writeQueue(queue.filter((op) => !dropped.has(op.localId)));
            if (!cancelled) persist(serverItems);
          }
          await flush();
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
  }, [enqueue, flush, persist, readQueue, rememberId, writeQueue]);

  const addTodo = useCallback(
    async (text: string, opts: Partial<TodoItem> = {}): Promise<TodoItem> => {
      const clean = text.trim();
      if (!clean) throw new Error("A to-do needs a few words of text.");
      const item: TodoItem = normalizeItem({
        ...opts,
        id: newId(),
        text: clean,
        done: false,
        createdAt: Date.now(),
        source: "manual",
      });
      persist([item, ...todosRef.current]);
      enqueue({ kind: "add", localId: item.id, body: itemToBody(item) });
      await flush();
      return todosRef.current.find((t) => t.id === item.id) ?? { ...item, id: resolveId(item.id) };
    },
    [persist, enqueue, flush, resolveId],
  );

  const toggleTodo = useCallback(
    async (id: string): Promise<void> => {
      const current = todosRef.current.find((t) => t.id === id);
      if (!current) return;
      const done = !current.done;
      persist(todosRef.current.map((t) => (t.id === id ? { ...t, done } : t)));
      enqueue({ kind: "update", localId: id, body: { done } });
    },
    [persist, enqueue],
  );

  const updateTodo = useCallback(
    async (id: string, patch: Partial<TodoItem>): Promise<void> => {
      if (!todosRef.current.some((t) => t.id === id)) return;
      const clean: Partial<TodoItem> = { ...patch };
      delete clean.id;
      delete clean.createdAt;
      if (typeof clean.text === "string") {
        clean.text = clean.text.trim();
        if (clean.text === "") return;
      }
      const body = patchToBody(clean);
      persist(todosRef.current.map((t) => (t.id === id ? { ...t, ...clean } : t)));
      if (Object.keys(body).length > 0) enqueue({ kind: "update", localId: id, body });
    },
    [persist, enqueue],
  );

  const deleteTodo = useCallback(
    async (id: string): Promise<void> => {
      persist(todosRef.current.filter((t) => t.id !== id));
      enqueue({ kind: "delete", localId: id });
    },
    [persist, enqueue],
  );

  return { todos, loading, addTodo, toggleTodo, updateTodo, deleteTodo };
}
