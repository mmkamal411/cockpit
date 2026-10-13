"use client";

import { useState } from "react";
import type { IntegrationStatus } from "@/lib/admin/types";
import { Pill, formatTime } from "@/components/admin/ui";

function statusTone(status: string): "green" | "red" | "amber" | "muted" {
  const s = status.toLowerCase();
  if (s === "ok" || s === "connected" || s === "healthy") return "green";
  if (s === "down" || s === "error" || s === "failed") return "red";
  if (s === "degraded" || s === "warning") return "amber";
  return "muted";
}

export function IntegrationCard({ integration }: { integration: IntegrationStatus }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/admin/integrations/${encodeURIComponent(integration.id)}/test`,
        { method: "POST", headers: { Accept: "application/json" } },
      );
      const body = await res.json().catch(() => ({}));
      const ok = res.ok;
      setResult({
        ok,
        message:
          typeof body?.message === "string"
            ? body.message
            : ok
              ? "Connection test passed."
              : (body?.error ?? `Test failed (HTTP ${res.status}).`),
      });
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "Connection test failed.",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-star">{integration.name}</h3>
          <p className="mt-1 text-xs text-dim">{integration.detail || "No detail reported."}</p>
        </div>
        <Pill tone={result ? (result.ok ? "green" : "red") : statusTone(integration.status)}>
          {result ? (result.ok ? "ok" : "down") : integration.status}
        </Pill>
      </div>

      <p className="mt-3 font-mono text-[11px] text-dim">
        Last checked: {formatTime(integration.last_checked)}
      </p>

      {result && (
        <p
          className={`mt-2 rounded-lg border px-3 py-2 font-mono text-xs ${
            result.ok
              ? "border-green-400/30 bg-green-400/5 text-green-300"
              : "border-red-500/40 bg-red-500/5 text-red-300"
          }`}
        >
          {result.message}
        </p>
      )}

      <button
        type="button"
        onClick={test}
        disabled={testing}
        className="mt-3 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-4 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-40"
      >
        {testing ? "Testing…" : "Test connection"}
      </button>
    </div>
  );
}
