"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  effectiveStatus,
  groupBills,
  totalDue,
  dueLabel,
  daysOverdue,
  type BillGroup,
} from "@/lib/bills/logic";

interface Bill {
  id: string;
  name: string;
  payee?: string | null;
  amount?: number | string | null;
  due_date?: string | null;
  due_day?: number | null;
  cadence?: string | null;
  status?: string | null;
  paid_at?: string | null;
  snoozed_until?: string | null;
  issuer_url?: string | null;
  notes?: string | null;
  effective_status?: string;
}

interface Draft {
  id: string;
  candidate_json: { issuer?: string; amount?: number; due_date?: string; confidence?: number };
  created_at: string;
}

const GROUP_META: { key: BillGroup; title: string; empty: string; accent: string }[] = [
  { key: "overdue", title: "Overdue", empty: "Nothing overdue. The bridge is clear.", accent: "text-red-400" },
  { key: "due", title: "Due this week", empty: "Nothing due this week.", accent: "text-neon-amber" },
  { key: "upcoming", title: "Upcoming", empty: "Nothing else on the horizon.", accent: "text-neon-cyan" },
  { key: "paid", title: "Paid this month", empty: "Nothing paid yet this month.", accent: "text-neon-green" },
];

function fmtAmount(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return "$—";
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Something went wrong.");
  }
  return body as T;
}

/** Money — Bills: every obligation, one calm view, one-tap paid. */
export function BillsApplet() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "month" | "add">("list");
  const [monthData, setMonthData] = useState<{
    month: string;
    bills: Bill[];
    total: number;
    paid_total: number;
    delta_label: string;
  } | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add-bill form state
  const [fName, setFName] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fDueDate, setFDueDate] = useState("");
  const [fCadence, setFCadence] = useState("one-off");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [billsRes, draftsRes] = await Promise.all([
        api<{ bills: Bill[] }>("/api/bills"),
        api<{ drafts: Draft[] }>("/api/bills/drafts").catch(() => ({ drafts: [] as Draft[] })),
      ]);
      setBills(billsRes.bills);
      setDrafts(draftsRes.drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your bills.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadMonth = useCallback(async (cursor: string) => {
    try {
      const data = await api<{
        month: string;
        bills: Bill[];
        total: number;
        paid_total: number;
        delta_label: string;
      }>(`/api/bills/month?month=${cursor}`);
      setMonthData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the month view.");
    }
  }, []);

  useEffect(() => {
    if (view === "month") loadMonth(monthCursor);
  }, [view, monthCursor, loadMonth]);

  const groups = useMemo(() => groupBills(bills), [bills]);
  const due7 = useMemo(() => totalDue(bills, 7), [bills]);

  async function markPaid(id: string) {
    setBusyId(id);
    try {
      const res = await api<{ bill: Bill; next_bill?: Bill }>("/api/bills/" + id + "/mark-paid", {
        method: "POST",
      });
      setBills((prev) => {
        const without = prev.filter((b) => b.id !== id);
        const updated = [...without, res.bill];
        if (res.next_bill) updated.push(res.next_bill);
        return updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't mark that paid.");
    } finally {
      setBusyId(null);
    }
  }

  async function snooze(id: string) {
    setBusyId(id);
    try {
      const res = await api<{ bill: Bill }>("/api/bills/" + id + "/snooze", {
        method: "POST",
        body: JSON.stringify({ days: 3 }),
      });
      setBills((prev) => prev.map((b) => (b.id === id ? res.bill : b)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't snooze that.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeBill(id: string) {
    if (!window.confirm("Remove this bill? You can always add it back.")) return;
    setBusyId(id);
    try {
      await api("/api/bills/" + id, { method: "DELETE" });
      setBills((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDraft(id: string) {
    setBusyId(id);
    try {
      const res = await api<{ bill: Bill }>("/api/bills/drafts/" + id + "/confirm", { method: "POST" });
      setBills((prev) => [...prev, res.bill]);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that bill.");
    } finally {
      setBusyId(null);
    }
  }

  async function dismissDraft(id: string) {
    setBusyId(id);
    try {
      await api("/api/bills/drafts/" + id + "/dismiss", { method: "POST" });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setBusyId(null);
    } finally {
      setBusyId(null);
    }
  }

  async function addBill(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const name = fName.trim();
    if (!name) {
      setFormError("Give the bill a name.");
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ bill: Bill }>("/api/bills", {
        method: "POST",
        body: JSON.stringify({
          name,
          amount: fAmount === "" ? null : Number(fAmount),
          due_date: fDueDate || null,
          cadence: fCadence,
        }),
      });
      setBills((prev) => [...prev, res.bill]);
      setFName("");
      setFAmount("");
      setFDueDate("");
      setFCadence("one-off");
      setView("list");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't add that bill.");
    } finally {
      setSaving(false);
    }
  }

  function shiftMonth(dir: 1 | -1) {
    const [y, m] = monthCursor.split("-").map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setMonthCursor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-amber">Money</p>
        <h2 className="mt-1 text-xl font-semibold text-star">Bills</h2>
        <p className="text-sm text-dim">Checking what's due…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-amber">Money</p>
        <h2 className="mt-1 text-xl font-semibold text-star">Bills</h2>
        {error && (
          <p className="mt-2 rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-2.5 text-xs leading-relaxed text-stardust">
            {error}{" "}
            <button type="button" onClick={refresh} className="underline text-star">
              Try again
            </button>
          </p>
        )}
      </div>

      {/* View tabs */}
      <div className="flex gap-2">
        {(
          [
            ["list", "Bills"],
            ["month", "Month"],
            ["add", "Add bill"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={
              "rounded-full px-4 py-1.5 text-xs font-medium transition-colors " +
              (view === key
                ? "border border-neon-amber/40 bg-neon-amber/10 text-neon-amber"
                : "border border-line bg-panel-2/60 text-stardust hover:text-star")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {view === "add" && (
        <form onSubmit={addBill} className="space-y-3 rounded-2xl border border-line bg-panel-2/60 p-4">
          <h3 className="text-sm font-semibold text-star">Add a bill</h3>
          {formError && <p className="text-xs text-red-400">{formError}</p>}
          <div>
            <label htmlFor="bill-name" className="mb-1 block text-xs text-dim">
              Name
            </label>
            <input
              id="bill-name"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              placeholder="Electric bill"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-amber/60 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bill-amount" className="mb-1 block text-xs text-dim">
                Amount
              </label>
              <input
                id="bill-amount"
                value={fAmount}
                onChange={(e) => setFAmount(e.target.value)}
                placeholder="87.40"
                inputMode="decimal"
                className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-amber/60 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="bill-due" className="mb-1 block text-xs text-dim">
                Due date
              </label>
              <input
                id="bill-due"
                type="date"
                value={fDueDate}
                onChange={(e) => setFDueDate(e.target.value)}
                className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star focus:border-neon-amber/60 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label htmlFor="bill-cadence" className="mb-1 block text-xs text-dim">
              Repeats
            </label>
            <select
              id="bill-cadence"
              value={fCadence}
              onChange={(e) => setFCadence(e.target.value)}
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star focus:border-neon-amber/60 focus:outline-none"
            >
              <option value="one-off">Just once</option>
              <option value="monthly">Every month</option>
              <option value="quarterly">Every 3 months</option>
              <option value="annual">Every year</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-4 py-2.5 text-sm font-medium text-neon-amber transition-colors hover:bg-neon-amber/20 disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add bill"}
          </button>
        </form>
      )}

      {view === "month" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="rounded-xl border border-line bg-panel-2/60 px-3 py-1.5 text-sm text-stardust hover:text-star"
            >
              ←
            </button>
            <h3 className="text-sm font-semibold text-star">
              {monthData
                ? new Date(monthData.month + "-02T12:00:00").toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })
                : monthCursor}
            </h3>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="rounded-xl border border-line bg-panel-2/60 px-3 py-1.5 text-sm text-stardust hover:text-star"
            >
              →
            </button>
          </div>
          {monthData ? (
            <>
              <div className="rounded-2xl border border-line bg-panel-2/60 p-4">
                <p className="text-xs text-dim">Due this month</p>
                <p className="mt-1 text-2xl font-semibold text-star">
                  {fmtAmount(monthData.total)}
                </p>
                <p className="mt-1 text-xs text-stardust">
                  {fmtAmount(monthData.paid_total)} paid · {monthData.delta_label}
                </p>
              </div>
              <ul className="space-y-2">
                {monthData.bills.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between rounded-xl border border-line bg-panel-2/60 px-4 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium text-star">{b.name}</p>
                      <p className="text-xs text-dim">{dueLabel(b)}</p>
                    </div>
                    <p className="text-sm font-semibold text-star">{fmtAmount(b.amount)}</p>
                  </li>
                ))}
                {monthData.bills.length === 0 && (
                  <p className="text-sm text-dim">Nothing due this month.</p>
                )}
              </ul>
            </>
          ) : (
            <p className="text-sm text-dim">Loading the month…</p>
          )}
        </div>
      )}

      {view === "list" && (
        <>
          {/* Hero strip */}
          <div className="rounded-2xl border border-line bg-panel-2/60 p-4">
            <p className="text-xs text-dim">Due in the next 7 days</p>
            <p className="mt-1 text-3xl font-semibold text-star underline decoration-neon-amber/60 decoration-2 underline-offset-4">
              {fmtAmount(due7)}
            </p>
            <p className="mt-1 text-xs text-stardust">
              {groups.overdue.length > 0
                ? `${groups.overdue.length} overdue — take a look.`
                : "All caught up. Nice flying."}
            </p>
          </div>

          {/* Detected tray (v1: usually empty — the email parser is deferred) */}
          {drafts.length > 0 && (
            <section aria-label="Bills found in your email">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                Found in your email ({drafts.length})
              </h3>
              <ul className="space-y-2">
                {drafts.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-neon-cyan/25 bg-panel-2/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-star">
                        {d.candidate_json.issuer ?? "Unknown bill"}
                      </p>
                      <p className="text-xs text-dim">
                        {d.candidate_json.amount != null ? fmtAmount(d.candidate_json.amount) : "Amount unknown"}
                        {d.candidate_json.due_date ? ` · due ${d.candidate_json.due_date}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={busyId === d.id}
                        onClick={() => confirmDraft(d.id)}
                        className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-1.5 text-xs font-medium text-neon-cyan hover:bg-neon-cyan/20 disabled:opacity-50"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        disabled={busyId === d.id}
                        onClick={() => dismissDraft(d.id)}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs text-dim hover:text-star disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Grouped bill list */}
          {bills.length === 0 ? (
            <div className="rounded-2xl border border-line bg-panel-2/60 p-6 text-center">
              <p className="text-sm font-medium text-star">No bills tracked yet.</p>
              <p className="mt-1 text-xs leading-relaxed text-stardust">
                Add your first bill and the cockpit will watch it — what&apos;s due,
                what&apos;s overdue, and what&apos;s coming up.
              </p>
              <button
                type="button"
                onClick={() => setView("add")}
                className="mt-4 rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-5 py-2.5 text-sm font-medium text-neon-amber transition-colors hover:bg-neon-amber/20"
              >
                Add your first bill
              </button>
            </div>
          ) : (
            GROUP_META.map(({ key, title, empty, accent }) => (
              <section key={key} aria-label={title}>
                <h3 className={`mb-2 text-xs font-semibold uppercase tracking-[0.2em] ${accent}`}>
                  {title} ({groups[key].length})
                </h3>
                {groups[key].length === 0 ? (
                  <p className="text-xs text-dim">{empty}</p>
                ) : (
                  <ul className="space-y-2">
                    {groups[key].map((b) => {
                      const status = effectiveStatus(b);
                      const overdue = daysOverdue(b);
                      return (
                        <li
                          key={b.id}
                          className="rounded-xl border border-line bg-panel-2/60 px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-star">{b.name}</p>
                              <p className="text-xs text-dim" aria-label={`${b.name}, ${fmtAmount(b.amount)}, ${dueLabel(b)}`}>
                                {fmtAmount(b.amount)} · {dueLabel(b)}
                                {overdue > 0 && (
                                  <span className="text-red-400"> · {overdue}d late</span>
                                )}
                              </p>
                            </div>
                            {status !== "paid" ? (
                              <button
                                type="button"
                                disabled={busyId === b.id}
                                onClick={() => markPaid(b.id)}
                                className="shrink-0 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-xs font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50 min-h-[44px]"
                              >
                                {busyId === b.id ? "…" : "Mark paid"}
                              </button>
                            ) : (
                              <span className="shrink-0 rounded-full bg-neon-green/15 px-3 py-1 text-xs font-medium text-neon-green ring-1 ring-neon-green/30">
                                Paid
                              </span>
                            )}
                          </div>
                          {status !== "paid" && (
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                disabled={busyId === b.id}
                                onClick={() => snooze(b.id)}
                                className="text-xs text-dim underline-offset-2 hover:text-star hover:underline disabled:opacity-50"
                              >
                                Remind me in 3 days
                              </button>
                              <button
                                type="button"
                                disabled={busyId === b.id}
                                onClick={() => removeBill(b.id)}
                                className="text-xs text-dim underline-offset-2 hover:text-red-400 hover:underline disabled:opacity-50"
                              >
                                Remove
                              </button>
                              {b.issuer_url && (
                                <a
                                  href={b.issuer_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-neon-cyan underline-offset-2 hover:underline"
                                >
                                  Pay site ↗
                                </a>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
