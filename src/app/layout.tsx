import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CockpitShell } from "@/components/cockpit-shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pookie — Your personal co-pilot",
  description:
    "Pookie is the calm intelligence at the center of your life — your schedule, your goals, your money, your health — quietly handled while you fly.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
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
