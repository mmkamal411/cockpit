"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/auth-form";

/** Plain-English translations of every ?error= code the auth flow can send. */
const ERROR_COPY: Record<string, string> = {
  auth: "Something went wrong signing you in. Please try again.",
  auth_expired: "That sign-in link has expired. Request a fresh one below.",
  auth_pkce: "Your browser blocked the sign-in handshake. Try again in a fresh tab.",
  email_invalid: "That email address doesn't look right. Check it and try again.",
  email_failed: "We couldn't send the sign-in link. Check your connection and try again.",
  oauth_failed: "Google sign-in didn't complete. Please try again.",
  provision:
    "We couldn't finish setting up your account. Sign in once more — that usually completes the setup.",
};

function LoginForm() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  // Post-auth destination: invite links pass ?next=/invite/<token> so the
  // new pilot lands back on their invite after signing in. Same-origin only.
  const nextParam = searchParams.get("next");
  const safeNext =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/home";

  const errorText = errorCode ? ERROR_COPY[errorCode] ?? ERROR_COPY.auth : "";

  return (
    <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-line bg-panel/70 p-8 shadow-[0_24px_80px_rgb(0_0_0/0.55)] backdrop-blur-xl">
        <AuthForm
          next={safeNext}
          heading="Welcome aboard"
          subheading="Sign in to reach your bridge."
        />

        {errorText && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-sm leading-relaxed text-neon-amber"
          >
            {errorText}
          </p>
        )}

        <p className="mt-6 text-center text-xs leading-relaxed text-dim">
          No passwords to remember. No children questions, ever —{" "}
          <Link href="/" className="underline-offset-2 hover:text-stardust hover:underline">
            back to the stars
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <p className="text-sm text-stardust">Preparing your sign-in…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
