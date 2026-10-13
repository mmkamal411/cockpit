"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Cadence = "monthly" | "quarterly" | "yearly";
type SubStatus = "active" | "paused" | "cancelled";

interface Subscription {
  id: string;
  name: string;
  amount?: number | string | null;
  cadence?: string | null;
  next_renewal?: string | null;
  category?: string | null;
  status?: string | null;
  notes?: string | null;
}

const DIVISOR: Record<Cadence, number> = { monthly: 1, quarterly: 3, yearly: 12 };

const CATEGORIES = [
  "Entertainment",
  "Music",
  "News",
  "Software",
  "Health & Fitness",
  "Home",
  "Other",
] as const;

function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return "$—";
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(amount: number | string | null | undefined): number {
  const n = Number(amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function cadenceOf(s: Subscription): Cadence {
  const c = (s.cadence ?? "monthly").toLowerCase();
  return c === "yearly" || c === "quarterly" ? c : "monthly";
}

function monthlyEquiv(s: Subscription): number {
  return num(s.amount) / DIVISOR[cadenceOf(s)];
}

function cadenceShort(s: Subscription): string {
  return cadenceOf(s) === "monthly" ? "/mo" : cadenceOf(s) === "quarterly" ? "/qtr" : "/yr";
}

/** "Netflix — $15.99/mo" or "$99/yr → $8.25/mo" for non-monthly cadences. */
function costLabel(s: Subscription): string {
  const c = cadenceOf(s);
  if (c === "monthly") return `${fmtAmount(num(s.amount))}/mo`;
  return `${fmtAmount(num(s.amount))}${cadenceShort(s)} → ${fmtAmount(monthlyEquiv(s))}/mo`;
}

function renewalLabel(s: Subscription): string {
  if (!s.next_renewal) {
    return cadenceOf(s) === "yearly" ? "renews yearly" : "renews " + cadenceOf(s);
  }
  const d = new Date(s.next_renewal + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "renewal date unknown";
  return "renews " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

/** Money — Subscriptions: every recurring charge, one calm view, true monthly cost. */
export function SubscriptionsApplet() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [annualTotal, setAnnualTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "add">("list");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Add-subscription form state
  const [fName, setFName] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fCadence, setFCadence] = useState<Cadence>("monthly");
  const [fRenewal, setFRenewal] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{
        subscriptions: Subscription[];
        monthly_total: number;
        annual_total: number;
      }>("/api/subscriptions");
      setSubs(data.subscriptions);
      setMonthlyTotal(data.monthly_total);
      setAnnualTotal(data.annual_total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your subscriptions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const active = useMemo(
    () =>
      subs
        .filter((s) => (s.status ?? "active") === "active")
        .sort((a, b) => (a.next_renewal ?? "").localeCompare(b.next_renewal ?? "")),
    [subs]
  );
  const paused = useMemo(() => subs.filter((s) => s.status === "paused"), [subs]);
  const cancelled = useMemo(() => subs.filter((s) => s.status === "cancelled"), [subs]);

  async function setStatus(id: string, status: SubStatus) {
    setBusyId(id);
    try {
      const res = await api<{ subscription: Subscription }>(`/api/subscriptions/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      setSubs((prev) => prev.map((s) => (s.id === id ? res.subscription : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that subscription.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeSub(id: string) {
    // Two-tap inline confirm (no native window.confirm — it blocks the main
    // thread and freezes the page in some browsers/automation).
    setConfirmRemoveId(null);
    setBusyId(id);
    try {
      await api(`/api/subscriptions/${id}`, { method: "DELETE" });
      setSubs((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that subscription.");
    } finally {
      setBusyId(null);
    }
  }

  /** Two-tap inline remove button — no native dialogs. */
  function removeButton(id: string, extraClass = "") {
    if (confirmRemoveId === id) {
      return (
        <>
          <span className="text-xs text-dim">Remove?</span>
          <button
            type="button"
            disabled={busyId === id}
            onClick={() => setConfirmRemoveId(null)}
            className={`text-xs text-dim underline-offset-2 hover:text-star hover:underline disabled:opacity-50 ${extraClass}`}
          >
            Keep it
          </button>
          <button
            type="button"
            disabled={busyId === id}
            onClick={() => removeSub(id)}
            className={`text-xs font-medium text-red-400 underline-offset-2 hover:underline disabled:opacity-50 ${extraClass}`}
          >
            {busyId === id ? "Removing…" : "Yes, remove"}
          </button>
        </>
      );
    }
    return (
      <button
        type="button"
        disabled={busyId === id}
        onClick={() => setConfirmRemoveId(id)}
        className={`text-xs text-dim underline-offset-2 hover:text-red-400 hover:underline disabled:opacity-50 ${extraClass}`}
      >
        Remove
      </button>
    );
  }

  async function addSubscription(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const name = fName.trim();
    if (!name) {
      setFormError("Give the subscription a name.");
      return;
    }
    const amount = Number(fAmount);
    if (fAmount === "" || !Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter what it costs — a number above zero, like 12.99.");
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ subscription: Subscription }>("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          name,
          amount,
          cadence: fCadence,
          next_renewal: fRenewal || null,
          category: fCategory || null,
          notes: fNotes.trim() || null,
        }),
      });
      setSubs((prev) => [...prev, res.subscription]);
      setFName("");
      setFAmount("");
      setFCadence("monthly");
      setFRenewal("");
      setFCategory("");
      setFNotes("");
      setView("list");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't add that subscription.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-amber">Money</p>
        <h2 className="mt-1 text-xl font-semibold text-star">Subscriptions</h2>
        <p className="text-sm text-dim">Tallying your subscriptions…</p>
      </div>
    );
  }

  const showEmpty = subs.length === 0 && !error;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-amber">Money</p>
        <h2 className="mt-1 text-xl font-semibold text-star">Subscriptions</h2>
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
            ["list", "Subscriptions"],
            ["add", "Add"],
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
        <form
          onSubmit={addSubscription}
          className="space-y-3 rounded-2xl border border-line bg-panel-2/60 p-4"
        >
          <h3 className="text-sm font-semibold text-star">Add a subscription</h3>
          {formError && <p className="text-xs text-red-400">{formError}</p>}
          <div>
            <label htmlFor="sub-name" className="mb-1 block text-xs text-dim">
              Name
            </label>
            <input
              id="sub-name"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              placeholder="Netflix"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-amber/60 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sub-amount" className="mb-1 block text-xs text-dim">
                Amount
              </label>
              <input
                id="sub-amount"
                value={fAmount}
                onChange={(e) => setFAmount(e.target.value)}
                placeholder="12.99"
                inputMode="decimal"
                className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-amber/60 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="sub-cadence" className="mb-1 block text-xs text-dim">
                Billed
              </label>
              <select
                id="sub-cadence"
                value={fCadence}
                onChange={(e) => setFCadence(e.target.value as Cadence)}
                className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star focus:border-neon-amber/60 focus:outline-none"
              >
                <option value="monthly">Every month</option>
                <option value="quarterly">Every 3 months</option>
                <option value="yearly">Every year</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sub-renewal" className="mb-1 block text-xs text-dim">
                Next renewal
              </label>
              <input
                id="sub-renewal"
                type="date"
                value={fRenewal}
                onChange={(e) => setFRenewal(e.target.value)}
                className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star focus:border-neon-amber/60 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="sub-category" className="mb-1 block text-xs text-dim">
                Category
              </label>
              <select
                id="sub-category"
                value={fCategory}
                onChange={(e) => setFCategory(e.target.value)}
                className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star focus:border-neon-amber/60 focus:outline-none"
              >
                <option value="">Pick one…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="sub-notes" className="mb-1 block text-xs text-dim">
              Notes
            </label>
            <input
              id="sub-notes"
              value={fNotes}
              onChange={(e) => setFNotes(e.target.value)}
              placeholder="e.g. family plan, sharing with Ana"
              className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-amber/60 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-4 py-2.5 text-sm font-medium text-neon-amber transition-colors hover:bg-neon-amber/20 disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add subscription"}
          </button>
        </form>
      )}

      {view === "list" && (
        <>
          {/* Hero strip */}
          <div className="rounded-2xl border border-line bg-panel-2/60 p-4">
            <p className="text-xs text-dim">Every month</p>
            <p className="mt-1 text-3xl font-semibold text-star underline decoration-neon-amber/60 decoration-2 underline-offset-4">
              {fmtAmount(monthlyTotal)}
            </p>
            <p className="mt-1 text-xs text-stardust">
              {fmtAmount(annualTotal)} per year · {active.length} active
            </p>
          </div>

          {showEmpty ? (
            <div className="rounded-2xl border border-line bg-panel-2/60 p-6 text-center">
              <p className="text-sm font-medium text-star">No subscriptions tracked yet.</p>
              <p className="mt-1 text-xs leading-relaxed text-stardust">
                Add your first subscription and the cockpit will show what they cost —
                per month and per year, side by side.
              </p>
              <button
                type="button"
                onClick={() => setView("add")}
                className="mt-4 rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-5 py-2.5 text-sm font-medium text-neon-amber transition-colors hover:bg-neon-amber/20"
              >
                Add your first
              </button>
            </div>
          ) : (
            <>
              {/* Active */}
              <section aria-label="Active subscriptions">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-neon-amber">
                  Active ({active.length})
                </h3>
                {active.length === 0 ? (
                  <p className="text-xs text-dim">Nothing active. Pause or resume one below, or add a new one.</p>
                ) : (
                  <ul className="space-y-2">
                    {active.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-xl border border-line bg-panel-2/60 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-star">{s.name}</p>
                            <p
                              className="text-xs text-dim"
                              aria-label={`${s.name}, ${costLabel(s)}, ${renewalLabel(s)}`}
                            >
                              {costLabel(s)} · {renewalLabel(s)}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-semibold text-star">
                            {fmtAmount(monthlyEquiv(s))}
                            <span className="text-xs font-normal text-dim">/mo</span>
                          </p>
                        </div>
                        <div className="mt-2 flex gap-3">
                          <button
                            type="button"
                            disabled={busyId === s.id}
                            onClick={() => setStatus(s.id, "paused")}
                            className="min-h-[44px] text-xs text-dim underline-offset-2 hover:text-star hover:underline disabled:opacity-50"
                          >
                            Pause
                          </button>
                          <button
                            type="button"
                            disabled={busyId === s.id}
                            onClick={() => setStatus(s.id, "cancelled")}
                            className="min-h-[44px] text-xs text-dim underline-offset-2 hover:text-star hover:underline disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          {removeButton(s.id, "min-h-[44px]")}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Paused */}
              {paused.length > 0 && (
                <section aria-label="Paused subscriptions">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-neon-cyan">
                    Paused ({paused.length})
                  </h3>
                  <ul className="space-y-2">
                    {paused.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 opacity-80"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-star">{s.name}</p>
                            <p className="text-xs text-dim">
                              {costLabel(s)} · {renewalLabel(s)}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-semibold text-star">
                            {fmtAmount(monthlyEquiv(s))}
                            <span className="text-xs font-normal text-dim">/mo</span>
                          </p>
                        </div>
                        <div className="mt-2 flex gap-3">
                          <button
                            type="button"
                            disabled={busyId === s.id}
                            onClick={() => setStatus(s.id, "active")}
                            className="min-h-[44px] rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-1.5 text-xs font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
                          >
                            {busyId === s.id ? "…" : "Resume"}
                          </button>
                          {removeButton(s.id, "min-h-[44px]")}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Cancelled */}
              {cancelled.length > 0 && (
                <section aria-label="Cancelled subscriptions">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-dim">
                    Cancelled ({cancelled.length})
                  </h3>
                  <ul className="space-y-2">
                    {cancelled.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel-2/40 px-4 py-2.5 opacity-60"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-stardust">{s.name}</p>
                          <p className="text-xs text-dim">{costLabel(s)}</p>
                        </div>
                        {removeButton(s.id, "min-h-[44px] shrink-0")}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
