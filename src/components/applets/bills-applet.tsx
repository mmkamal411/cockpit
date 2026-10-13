"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  effectiveStatus,
  groupBills,
  totalDue,
  dueLabel,
  daysOverdue,
  type BillGroup,
} from "@/lib/bills/logic";
import { extractBillFields, createBillReader, type BillReader } from "@/lib/bill-scan";

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

function CameraIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
      <path d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
    </svg>
  );
}

/**
 * Pre-scan consent dialog for "Scan a bill". Exact copy per BILLSCAN-UX.md §2.
 * Focus moves to the consent button on open, Tab is trapped inside, Esc
 * dismisses as "Not now", and focus returns to the Scan button on close.
 */
function ScanDisclaimerDialog({
  onConfirm,
  onDismiss,
  returnFocusRef,
}: {
  onConfirm: () => void;
  onDismiss: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const el = dialogRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => node.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // Return focus to the "Scan a bill" button when the dialog goes away.
  useEffect(
    () => () => {
      returnFocusRef.current?.focus();
    },
    [returnFocusRef],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      onClick={onDismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-disclaimer-title"
        className="w-full max-w-sm rounded-2xl border border-line bg-panel-2 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="scan-disclaimer-title" className="text-base font-semibold text-star">
          Before you scan
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-stardust">
          Your photo is read on this device to fill in the form — nothing is sent
          anywhere. The photo is thrown away right after and is never saved,
          stored, or shared. You&apos;re choosing to do this yourself, and nothing
          fills in or saves until you check it and tap &ldquo;Add bill&rdquo;.
        </p>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className="mt-4 w-full rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-4 py-2.5 text-sm font-medium text-neon-amber hover:bg-neon-amber/20"
        >
          I understand — scan the bill
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 w-full rounded-xl border border-line px-4 py-2.5 text-sm text-dim hover:text-star"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
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
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Add-bill form state
  const [fName, setFName] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fDueDate, setFDueDate] = useState("");
  const [fCadence, setFCadence] = useState("one-off");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Scan-a-bill state (BILLSCAN-UX.md). The photo is ephemeral: it exists only
  // as an in-memory object URL during OCR and is revoked the moment OCR
  // finishes or is cancelled — never POSTed, never stored.
  const [scanNotice, setScanNotice] = useState<
    "disclaimer" | "denied" | "reading" | "failed" | null
  >(null);
  const [scanAnnounce, setScanAnnounce] = useState("");
  const [suggested, setSuggested] = useState({ name: false, amount: false, dueDate: false });
  const consentRef = useRef(false); // dialog consent stands for this session (retries skip it)
  const cancelledRef = useRef(false);
  const readerRef = useRef<BillReader | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const scanBtnRef = useRef<HTMLButtonElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const pickerInputRef = useRef<HTMLInputElement>(null);

  const dismissDisclaimer = useCallback(() => {
    setScanNotice(null); // "Not now": back to the untouched form, nothing changes
  }, []);

  // Lock background scroll while the disclaimer dialog is open.
  useEffect(() => {
    if (scanNotice !== "disclaimer") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [scanNotice]);

  const startCapture = useCallback((preferCamera: boolean) => {
    setScanNotice(null);
    const mobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent || "");
    if (preferCamera && mobile) {
      const canCamera =
        typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
      if (!canCamera) {
        setScanNotice("denied");
        setScanAnnounce(
          "We couldn't open your camera. You can pick a photo instead — or type the bill in below. Nothing was saved.",
        );
        return;
      }
      captureInputRef.current?.click();
    } else {
      pickerInputRef.current?.click();
    }
  }, []);

  const confirmDisclaimer = useCallback(() => {
    consentRef.current = true;
    startCapture(true);
  }, [startCapture]);

  const openScan = useCallback(() => {
    // Consent stands for the session: retries re-open capture directly.
    if (consentRef.current) startCapture(true);
    else setScanNotice("disclaimer");
  }, [startCapture]);

  const cancelScan = useCallback(() => {
    cancelledRef.current = true;
    readerRef.current?.cancel(); // terminates the worker immediately
    readerRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setScanNotice(null);
    setScanAnnounce("");
  }, []);

  const runScan = useCallback(
    async (file: File) => {
      cancelledRef.current = false;
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setScanNotice("reading");
      setScanAnnounce("Reading your bill…");
      try {
        // Tesseract.js is lazy-loaded here — the WASM engine never enters the
        // initial bundle; it is fetched only after the user confirms the scan.
        readerRef.current = await createBillReader();
        const text = await readerRef.current.read(url);
        if (cancelledRef.current) return;
        const fields = extractBillFields(text);
        const found = [fields.name, fields.amount, fields.dueDate].filter(Boolean).length;
        if (found === 0) {
          setScanNotice("failed");
          setScanAnnounce(
            "We couldn't read that bill. You can type it in below — nothing was saved.",
          );
          return;
        }
        if (fields.name) setFName(fields.name);
        if (fields.amount) setFAmount(fields.amount);
        if (fields.dueDate) setFDueDate(fields.dueDate);
        setSuggested({
          name: !!fields.name,
          amount: !!fields.amount,
          dueDate: !!fields.dueDate,
        });
        setScanNotice(null);
        setScanAnnounce("We filled in what we could read — please check before saving.");
      } catch {
        if (!cancelledRef.current) {
          setScanNotice("failed");
          setScanAnnounce(
            "We couldn't read that bill. You can type it in below — nothing was saved.",
          );
        }
      } finally {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
        if (!cancelledRef.current) {
          readerRef.current?.cancel(); // worker cleanup (terminates the engine)
        }
        readerRef.current = null;
      }
    },
    [],
  );

  const handleScanFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      e.target.value = ""; // allow re-picking the same photo
      if (!file) {
        // Picker dismissed without a photo: back to the untouched form.
        setScanNotice(null);
        return;
      }
      void runScan(file);
    },
    [runScan],
  );

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
    // Two-tap inline confirm (no native window.confirm — it blocks the main
    // thread and freezes the page in some browsers/automation).
    setConfirmRemoveId(null);
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
      setSuggested({ name: false, amount: false, dueDate: false });
      setScanNotice(null);
      setScanAnnounce("");
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
        <>
          {/* Single live region for all scan announcements (BILLSCAN-UX.md §8). */}
          <div aria-live="polite" className="sr-only">
            {scanAnnounce}
          </div>
          {scanNotice === "reading" ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-panel-2/60 p-8">
              <svg
                aria-hidden="true"
                className="h-10 w-10 animate-spin text-neon-amber motion-reduce:animate-none"
                viewBox="0 0 40 40"
                fill="none"
              >
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  stroke="currentColor"
                  strokeOpacity="0.2"
                  strokeWidth="4"
                />
                <path
                  d="M36 20a16 16 0 00-16-16"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </svg>
              <p aria-hidden="true" className="text-sm text-stardust">
                Reading your bill…
              </p>
              <button
                type="button"
                onClick={cancelScan}
                className="rounded-xl border border-line px-4 py-2 text-sm text-dim hover:text-star"
              >
                Cancel
              </button>
            </div>
          ) : (
            <form
              onSubmit={addBill}
              className="space-y-3 rounded-2xl border border-line bg-panel-2/60 p-4"
            >
              <h3 className="text-sm font-semibold text-star">Add a bill</h3>
              <button
                ref={scanBtnRef}
                type="button"
                onClick={openScan}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-sm font-medium text-stardust hover:text-star"
              >
                <CameraIcon />
                Scan a bill
              </button>
              {scanNotice === "denied" && (
                <div className="space-y-2 rounded-xl border border-line bg-panel-2/60 px-4 py-2.5">
                  <p className="text-xs leading-relaxed text-stardust">
                    We couldn&apos;t open your camera. You can pick a photo
                    instead — or type the bill in below. Nothing was saved.
                  </p>
                  <button
                    type="button"
                    onClick={() => startCapture(false)}
                    className="w-full rounded-xl border border-line px-4 py-2 text-sm text-stardust hover:text-star"
                  >
                    Choose a photo
                  </button>
                </div>
              )}
              {scanNotice === "failed" && (
                <div className="space-y-2 rounded-xl border border-line bg-panel-2/60 px-4 py-2.5">
                  <p className="text-xs leading-relaxed text-stardust">
                    We couldn&apos;t read that bill. You can type it in below —
                    nothing was saved.
                  </p>
                  <button
                    type="button"
                    onClick={() => startCapture(true)}
                    className="w-full rounded-xl border border-line px-4 py-2 text-sm text-stardust hover:text-star"
                  >
                    Try again
                  </button>
                </div>
              )}
              {(suggested.name || suggested.amount || suggested.dueDate) &&
                scanNotice !== "denied" && (
                  <p className="rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-4 py-2.5 text-xs leading-relaxed text-neon-amber">
                    We filled in what we could read — please check before saving.
                  </p>
                )}
              {formError && <p className="text-xs text-red-400">{formError}</p>}
              <div>
                <label
                  htmlFor="bill-name"
                  className="mb-1 flex items-center gap-2 text-xs text-dim"
                >
                  Name
                  {suggested.name && (
                    <span className="text-[11px] text-neon-amber/90">
                      Suggested — check me
                    </span>
                  )}
                </label>
                <input
                  id="bill-name"
                  value={fName}
                  onChange={(e) => {
                    setFName(e.target.value);
                    if (suggested.name) setSuggested((s) => ({ ...s, name: false }));
                  }}
                  placeholder="Electric bill"
                  className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-amber/60 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="bill-amount"
                    className="mb-1 flex items-center gap-2 text-xs text-dim"
                  >
                    Amount
                    {suggested.amount && (
                      <span className="text-[11px] text-neon-amber/90">
                        Suggested — check me
                      </span>
                    )}
                  </label>
                  <input
                    id="bill-amount"
                    value={fAmount}
                    onChange={(e) => {
                      setFAmount(e.target.value);
                      if (suggested.amount)
                        setSuggested((s) => ({ ...s, amount: false }));
                    }}
                    placeholder="87.40"
                    inputMode="decimal"
                    className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-amber/60 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bill-due"
                    className="mb-1 flex items-center gap-2 text-xs text-dim"
                  >
                    Due date
                    {suggested.dueDate && (
                      <span className="text-[11px] text-neon-amber/90">
                        Suggested — check me
                      </span>
                    )}
                  </label>
                  <input
                    id="bill-due"
                    type="date"
                    value={fDueDate}
                    onChange={(e) => {
                      setFDueDate(e.target.value);
                      if (suggested.dueDate)
                        setSuggested((s) => ({ ...s, dueDate: false }));
                    }}
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
              {/* Hidden capture inputs. The photo is ephemeral: it is read
                  on-device and the object URL is revoked right after OCR. */}
              <input
                ref={captureInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Scan a bill"
                className="hidden"
                onChange={handleScanFile}
              />
              <input
                ref={pickerInputRef}
                type="file"
                accept="image/*"
                aria-label="Scan a bill"
                className="hidden"
                onChange={handleScanFile}
              />
            </form>
          )}
          {scanNotice === "disclaimer" && (
            <ScanDisclaimerDialog
              onConfirm={confirmDisclaimer}
              onDismiss={dismissDisclaimer}
              returnFocusRef={scanBtnRef}
            />
          )}
        </>
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
                              {confirmRemoveId === b.id ? (
                                <>
                                  <span className="text-xs text-dim">Remove this bill?</span>
                                  <button
                                    type="button"
                                    disabled={busyId === b.id}
                                    onClick={() => setConfirmRemoveId(null)}
                                    className="text-xs text-dim underline-offset-2 hover:text-star hover:underline disabled:opacity-50"
                                  >
                                    Keep it
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === b.id}
                                    onClick={() => removeBill(b.id)}
                                    className="text-xs font-medium text-red-400 underline-offset-2 hover:underline disabled:opacity-50"
                                  >
                                    {busyId === b.id ? "Removing…" : "Yes, remove"}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busyId === b.id}
                                  onClick={() => setConfirmRemoveId(b.id)}
                                  className="text-xs text-dim underline-offset-2 hover:text-red-400 hover:underline disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              )}
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
