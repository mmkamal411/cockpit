// Shared types for the Today briefing surface (Team B, Worker B).
//
// The Today briefing is a READ-ONLY aggregation: overdue todos, today's
// schedule, todos due today, active nudges, and crew school items. Full
// todo CRUD belongs to the To-dos applet / useTodos() hook (Worker A).

// TODO(Worker A): once src/lib/use-todos.ts lands, import TodoItem from
// "@/lib/use-todos" and delete this local definition. The shape below is
// intentionally compatible with the Supabase `todos` table
// (title -> text, due_at -> dueAt) so the swap is a one-line change.
export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  dueAt: number | null;
  createdAt: number;
}

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
