// Shared types for the Today briefing surface (Team B, Worker B).
//
// The Today briefing is a READ-ONLY aggregation: overdue todos, today's
// schedule, todos due today, active nudges, and crew school items. Full
// todo CRUD belongs to the To-dos applet / useTodos() hook (Worker A).

// TodoItem is owned by Worker A (src/lib/use-todos.ts) — the shared shape
// used by both the to-do manager and this briefing surface.
export type { TodoItem } from "@/lib/use-todos";

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  allDay?: boolean;
}

export interface NudgeItem {
  id: string;
  text: string;
  kind: string;
}

export interface SchoolItem {
  crewMemberId: string;
  crewMemberName: string;
  text: string;
  dueAt?: number;
}

/** A completed todo or dismissed nudge, folded into "Handled today". */
export interface HandledItem {
  id: string;
  text: string;
  kind: "todo" | "nudge";
}

export interface TodayBriefing {
  date: string; // ISO date, pilot's local day (YYYY-MM-DD)
  sections: {
    overdue: TodoItem[];
    schedule: CalendarEvent[];
    dueToday: TodoItem[];
    nudges: NudgeItem[];
    school: SchoolItem[];
    handled: HandledItem[];
  };
  counts: {
    overdue: number;
    dueToday: number;
    events: number;
    nudges: number;
    school: number;
    handled: number;
  };
  warnings: string[];
}
