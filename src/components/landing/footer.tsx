"use client";

import Link from "next/link";

/** Landing footer — brand, legal links, and a final CTA. The legal pages
 *  are real documents, not stubs. */

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/do-not-sell", label: "Do Not Sell My Info" },
] as const;

export function LandingFooter() {
  return (
    <footer className="relative border-t border-line bg-panel px-6 py-10 sm:px-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="footer-orb" />
          <span className="text-base font-semibold tracking-wide text-star">Crystal</span>
        </div>
        <nav aria-label="Legal">
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="text-stardust underline-offset-4 transition-colors hover:text-neon-teal hover:underline"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="max-w-md text-center text-xs leading-relaxed text-dim">
          Crystal — a ball of light, watching over your day. We never sell
          your personal information, and your habits never leave your account.
        </p>
        <p className="text-[11px] text-dim">
          © {new Date().getFullYear()} Crystal. All rights reserved.
        </p>
      </div>
      <style>{FOOTER_CSS}</style>
    </footer>
  );
}

const FOOTER_CSS = `
.footer-orb {
  width: 24px; height: 24px; border-radius: 9999px; display: inline-block;
  background:
    radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.9) 0%, rgb(255 255 255 / 0) 36%),
    radial-gradient(circle at 50% 55%, #d8fff4 0%, #5eead4 42%, #0e7d6c 78%, #04211c 100%);
  box-shadow: 0 0 12px rgb(94 234 212 / 0.6);
}
`;
