import type { ReactNode } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { AdminNav } from "@/components/admin/admin-nav";
import { Pill } from "@/components/admin/ui";

/**
 * Admin command center shell.
 *
 * Session-gated: reads cookies per request — opt out of static-shell validation.
 */
export const instant = false;

export const metadata = {
  title: "Admin — Cockpit",
  description: "Cockpit administration command center.",
};

/** 403-style access-denied page — never a redirect loop. */
function AccessDenied() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-abyss px-4">
      <div className="w-full max-w-md rounded-xl border border-red-500/40 bg-black/80 p-8 text-center">
        <Pill tone="red">403</Pill>
        <h1 className="mt-4 text-lg font-semibold text-star">Access denied</h1>
        <p className="mt-2 text-sm text-dim">
          This area is restricted to Cockpit administrators. If you believe you
          should have access, ask the founder to add your email to the admin
          list.
        </p>
        <Link
          href="/home"
          className="mt-6 inline-block rounded-lg border border-cyan-400/40 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-400/10"
        >
          Back to Cockpit
        </Link>
      </div>
    </div>
  );
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  let adminEmail: string | null = null;
  try {
    adminEmail = await requireAdmin();
  } catch {
    adminEmail = null;
  }
  if (!adminEmail) return <AccessDenied />;

  return (
    <div className="min-h-dvh bg-abyss text-star">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Pill tone="red">ADMIN</Pill>
            <span className="text-sm font-semibold tracking-tight">
              Cockpit Command Center
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden font-mono text-xs text-dim sm:inline">
              {adminEmail}
            </span>
            <Link
              href="/home"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-stardust hover:border-cyan-400/40 hover:text-cyan-200"
            >
              Back to app
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        <aside className="lg:w-52 lg:shrink-0">
          <div className="lg:sticky lg:top-20">
            <AdminNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
