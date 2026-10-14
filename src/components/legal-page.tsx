import Link from "next/link";
import type { ReactNode } from "react";

/** Shared shell for the legal pages: plain-language heading, last-updated
 *  date, prose sections, and a way back to the landing page. */

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-dvh bg-abyss px-6 py-10 sm:px-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_40%_at_50%_0%,rgb(94_234_212/0.06)_0%,rgb(94_234_212/0)_100%)]"
      />
      <article className="relative mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-block rounded-full border border-line bg-white/5 px-4 py-1.5 text-xs font-medium text-stardust transition-colors hover:border-neon-teal/40 hover:text-neon-teal"
        >
          ← Back to Crystal
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-star sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-xs text-dim">Last updated: {updated}</p>
        <div className="legal-prose mt-8">{children}</div>
      </article>
      <style>{LEGAL_CSS}</style>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-star">{heading}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-stardust">{children}</div>
    </section>
  );
}

const LEGAL_CSS = `
.legal-prose p { margin: 0; }
.legal-prose ul { list-style: disc; padding-left: 1.4rem; }
.legal-prose li { margin-top: 0.35rem; }
.legal-prose strong { color: var(--color-star); font-weight: 600; }
`;
