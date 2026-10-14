import type { Metadata } from "next";
import { Suspense } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { CockpitShell } from "@/components/cockpit-shell";

// Self-hosted (2026-10-14): next/font/google downloads Geist from
// fonts.googleapis.com AT BUILD TIME. Fresh CI/sandboxed builds with no
// font cache fail when that fetch fails. These variable woff2 files
// (from the `geist` npm package) make the build hermetic — same faces,
// same --font-geist-* variables, zero network dependency.
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Crystal",
  description:
    "Crystal is the calm intelligence at the center of your life — your schedule, your goals, your money, your health — quietly handled while you fly.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-abyss text-star">
        {/* Suspense: usePathname() inside the shell must not block prerender. */}
        <Suspense fallback={<div className="min-h-dvh bg-abyss">{children}</div>}>
          <CockpitShell>{children}</CockpitShell>
        </Suspense>
      </body>
    </html>
  );
}
