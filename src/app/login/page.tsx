"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Plain-English translations of every ?error= code the auth flow can send. */
const ERROR_COPY: Record<string, string> = {
  auth: "Something went wrong signing you in. Please try again.",
  auth_expired: "That sign-in link has expired. Request a fresh one below.",
  auth_pkce: "Your browser blocked the sign-in handshake. Try again in a fresh tab.",
  email_invalid: "That email address doesn't look right. Check it and try again.",
  email_failed: "We couldn't send the sign-in link. Check your connection and try again.",
  oauth_failed: "Google sign-in didn't complete. Please try again.",
};

function callbackUrl(): string {
  return `${window.location.origin}/auth/callback?next=/home`;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [localError, setLocalError] = useState("");

  const errorText = localError || (errorCode ? ERROR_COPY[errorCode] ?? ERROR_COPY.auth : "");

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLocalError("");
    const clean = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setLocalError(ERROR_COPY.email_invalid);
      return;
    }
    setSending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: clean,
        options: { emailRedirectTo: callbackUrl() },
      });
      if (error) throw error;
      setLinkSent(true);
    } catch {
      setLocalError(ERROR_COPY.email_failed);
    } finally {
      setSending(false);
    }
  }

  async function signInWithGoogle() {
    setLocalError("");
    setGoogleBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl() },
      });
      if (error) throw error;
    } catch {
      setLocalError(ERROR_COPY.oauth_failed);
      setGoogleBusy(false);
    }
  }

  return (
    <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-line bg-panel/70 p-8 shadow-[0_24px_80px_rgb(0_0_0/0.55)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="login-orb" />
          <div>
            <p className="text-lg font-semibold text-star">Welcome aboard</p>
            <p className="text-xs text-stardust">Sign in to reach your bridge.</p>
          </div>
        </div>

        {errorText && (
          <p role="alert" className="mt-5 rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-sm leading-relaxed text-neon-amber">
            {errorText}
          </p>
        )}

        {linkSent ? (
          <div className="mt-6 rounded-2xl border border-neon-teal/30 bg-neon-teal/5 p-5 text-center">
            <p aria-hidden="true" className="text-3xl">✉️</p>
            <p className="mt-2 text-sm font-semibold text-star">Check your email</p>
            <p className="mt-1 text-sm leading-relaxed text-stardust">
              Your sign-in link is on its way to <span className="text-star">{email.trim()}</span>.
              It expires soon, so hop on it when it lands.
            </p>
            <button
              type="button"
              onClick={() => setLinkSent(false)}
              className="mt-3 text-xs text-dim underline-offset-2 hover:text-star hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="mt-6 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stardust">Email address</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                inputMode="email"
                className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-teal/60 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-xl border border-neon-teal/50 bg-neon-teal/15 px-4 py-2.5 text-sm font-semibold text-star transition-colors hover:bg-neon-teal/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Sending your link…" : "Email me a sign-in link"}
            </button>
          </form>
        )}

        <div className="my-5 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[11px] uppercase tracking-[0.2em] text-dim">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={googleBusy}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-star transition-colors hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#EA4335" d="M12 5.2c1.6 0 3 .6 4.1 1.6l3-3C17.2 2 14.8 1 12 1 7.7 1 3.9 3.5 2 7.1l3.4 2.7C6.3 7.4 8.9 5.2 12 5.2Z" />
            <path fill="#4285F4" d="M23 12.3c0-.9-.1-1.5-.2-2.3H12v4.1h6.3c-.3 1.5-1.3 2.7-2.7 3.5l3.3 2.6C20.8 18.4 23 15.7 23 12.3Z" />
            <path fill="#FBBC05" d="M5.4 14.1c-.3-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1L2 7.1C.7 9.3 0 11.6 0 14s.7 4.7 2 6.9l3.4-2.7c-.3-.7-.4-1.4 0-2.1Z" opacity=".9" />
            <path fill="#34A853" d="M12 23c3.2 0 5.9-1.1 7.9-2.9l-3.3-2.6c-.9.6-2.3 1.1-4.6 1.1-3.1 0-5.7-2.2-6.6-4.5L2 16.9C3.9 20.5 7.7 23 12 23Z" />
          </svg>
          {googleBusy ? "Opening Google…" : "Continue with Google"}
        </button>

        <p className="mt-6 text-center text-xs leading-relaxed text-dim">
          No passwords to remember. No children questions, ever —{" "}
          <Link href="/" className="underline-offset-2 hover:text-stardust hover:underline">
            back to the stars
          </Link>
          .
        </p>
      </div>
      <style>{LOGIN_CSS}</style>
    </div>
  );
}

const LOGIN_CSS = `
.login-orb {
  width: 40px; height: 40px; border-radius: 9999px; display: inline-block; flex-shrink: 0;
  background:
    radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.9) 0%, rgb(255 255 255 / 0) 36%),
    radial-gradient(circle at 50% 55%, #d8fff4 0%, #5eead4 42%, #0e7d6c 78%, #04211c 100%);
  box-shadow: 0 0 16px rgb(94 234 212 / 0.6), 0 0 40px rgb(94 234 212 / 0.25);
}
`;

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
