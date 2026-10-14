"use client";

import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

/** Landing sign-up section — the auth card right on the page, so a
 *  visitor never has to hunt for it. Wraps AuthForm in Suspense for the
 *  search-param read inside. */

export function LandingAuthSection() {
  return (
    <section
      id="signup"
      aria-labelledby="signup-heading"
      className="relative bg-abyss px-6 py-20 sm:px-10"
    >
      <div className="mx-auto max-w-md">
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.3em] text-neon-teal">
          Boarding
        </p>
        <h2
          id="signup-heading"
          className="mt-3 text-center text-3xl font-semibold tracking-tight text-star sm:text-4xl"
        >
          Sign up — it takes 30 seconds
        </h2>
        <p className="mt-3 text-center text-sm leading-relaxed text-stardust">
          Google, or a one-time code by email. No password, no credit card, no
          questions about anything else.
        </p>
        <div className="mt-8 rounded-3xl border border-line bg-panel/70 p-8 shadow-[0_24px_80px_rgb(0_0_0/0.55)] backdrop-blur-xl">
          <Suspense
            fallback={<p className="text-sm text-stardust">Preparing your sign-in…</p>}
          >
            <AuthForm next="/home" heading="Welcome aboard" />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs leading-relaxed text-dim">
          Already flying?{" "}
          <Link href="/login" className="underline-offset-2 hover:text-stardust hover:underline">
            Log in here
          </Link>
          . By signing up you agree to our{" "}
          <Link href="/terms" className="underline-offset-2 hover:text-stardust hover:underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline-offset-2 hover:text-stardust hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
