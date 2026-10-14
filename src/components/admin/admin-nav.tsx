"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sidebar navigation for the admin command center (client: active state). */

const ITEMS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/tables", label: "Tables" },
  { href: "/admin/query", label: "Query" },
  { href: "/admin/integrations", label: "Integrations" },
  { href: "/admin/audit", label: "Audit Log" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-1">
      {ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                : "border-transparent text-stardust hover:border-white/10 hover:bg-white/5 hover:text-star"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
