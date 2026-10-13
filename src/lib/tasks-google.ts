/**
 * tasks-google — Google Tasks API client, mirroring src/lib/calendar-google.ts.
 *
 * Token refresh is reused unchanged (refreshGoogleAccessToken): the same
 * OAuth connection carries both the calendar and tasks scopes.
 *
 * Google Tasks API surface used:
 *   GET  /tasks/v1/users/@me/lists
 *   GET  /tasks/v1/lists/{tasklistId}/tasks?showCompleted&showDeleted&updatedMin
 *   POST /tasks/v1/lists/{tasklistId}/tasks
 *   PATCH /tasks/v1/lists/{tasklistId}/tasks/{taskId}
 *   DELETE /tasks/v1/lists/{tasklistId}/tasks/{taskId}
 */

const TASKS_BASE = "https://tasks.googleapis.com/tasks/v1";

export interface GoogleTasklist {
  id: string;
  title: string;
}

export interface GoogleTask {
  id: string;
  title: string;
  notes: string | null;
  /** 'needsAction' | 'completed' */
  status: string;
  /** RFC3339 date (date-only, no time) or null. */
  due: string | null;
  /** RFC3339 timestamp of the last change. */
  updated: string | null;
  deleted: boolean;
}

interface TasklistListResponse {
  items?: { id?: string; title?: string }[];
}

interface TaskListResponse {
  items?: {
    id?: string;
    title?: string;
    notes?: string;
    status?: string;
    due?: string;
    updated?: string;
    deleted?: boolean;
  }[];
  nextPageToken?: string;
}

async function tasksFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${TASKS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Tasks API ${res.status}: ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

export async function listTasklists(accessToken: string): Promise<GoogleTasklist[]> {
  const data = (await tasksFetch(accessToken, "/users/@me/lists")) as TasklistListResponse | null;
  return (data?.items ?? [])
    .filter((l) => typeof l.id === "string")
    .map((l) => ({ id: l.id as string, title: l.title ?? "Tasks" }));
}

function toTask(raw: NonNullable<TaskListResponse["items"]>[number]): GoogleTask | null {
  if (typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    title: raw.title ?? "",
    notes: typeof raw.notes === "string" && raw.notes !== "" ? raw.notes : null,
    status: raw.status ?? "needsAction",
    due: typeof raw.due === "string" ? raw.due : null,
    updated: typeof raw.updated === "string" ? raw.updated : null,
    deleted: raw.deleted === true,
  };
}

/** All tasks in a tasklist (completed + deleted included for merge). */
export async function listTasks(
  accessToken: string,
  tasklistId: string,
): Promise<GoogleTask[]> {
  const out: GoogleTask[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      showCompleted: "true",
      showDeleted: "true",
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = (await tasksFetch(
      accessToken,
      `/lists/${encodeURIComponent(tasklistId)}/tasks?${params.toString()}`,
    )) as TaskListResponse | null;
    for (const raw of data?.items ?? []) {
      const task = toTask(raw);
      if (task) out.push(task);
    }
    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export interface NewGoogleTask {
  title: string;
  notes?: string | null;
  due?: string | null;
  status?: "needsAction" | "completed";
}

export async function insertTask(
  accessToken: string,
  tasklistId: string,
  task: NewGoogleTask,
): Promise<GoogleTask | null> {
  type RawTask = NonNullable<TaskListResponse["items"]>[number];
  const data = (await tasksFetch(accessToken, `/lists/${encodeURIComponent(tasklistId)}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      title: task.title,
      notes: task.notes ?? undefined,
      due: task.due ?? undefined,
      status: task.status ?? "needsAction",
    }),
  })) as RawTask | null;
  return data ? toTask(data) : null;
}

export async function patchTask(
  accessToken: string,
  tasklistId: string,
  taskId: string,
  patch: NewGoogleTask,
): Promise<GoogleTask | null> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.notes !== undefined) body.notes = patch.notes ?? null;
  if (patch.due !== undefined) body.due = patch.due;
  if (patch.status !== undefined) body.status = patch.status;
  const data = (await tasksFetch(
    accessToken,
    `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  )) as NonNullable<TaskListResponse["items"]>[number] | null;
  return data ? toTask(data) : null;
}

export async function deleteTask(
  accessToken: string,
  tasklistId: string,
  taskId: string,
): Promise<void> {
  await tasksFetch(
    accessToken,
    `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE" },
  );
}

/** Google Tasks `due` is an RFC3339 date; Cockpit stores epoch ms. */
export function googleDueToMs(due: string | null): number | null {
  if (!due) return null;
  const ms = Date.parse(due);
  return Number.isNaN(ms) ? null : ms;
}

/** Epoch ms -> RFC3339 date (Google Tasks due is date-only). */
export function msToGoogleDue(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}T00:00:00.000Z`;
}
