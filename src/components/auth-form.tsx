"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Plain-English copy for every auth error state. */
const ERROR_COPY: Record<string, string> = {
  email_invalid: "That email address doesn't look right. Check it and try again.",
  email_failed: "We couldn't send the code. Check your connection and try again.",
  code_invalid: "That code doesn't look right — it should be 6 digits.",
  code_failed:
    "That code didn't work. It may have expired — send yourself a fresh one and try again.",
  oauth_failed: "Google sign-in didn't complete. Please try again.",
};

export function AuthForm({
  next = "/home",
  heading = "Welcome aboard",
  subheading = "Sign in with a one-time code — no password to remember.",
}: {
  next?: string;
  heading?: string;
  subheading?: string;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const verifyingRef = useRef(false);

  function callbackUrl(): string {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  }

  async function sendCode(e: React.FormEvent) {
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
      // Sends the email that carries both the 6-digit code and a one-click
      // sign-in link. New pilots get an account automatically on verify.
      const { error } = await supabase.auth.signInWithOtp({
        email: clean,
        options: { emailRedirectTo: callbackUrl() },
      });
      if (error) throw error;
      setCode("");
      setStep("code");
    } catch {
      setLocalError(ERROR_COPY.email_failed);
    } finally {
      setSending(false);
    }
  }

  const verifyCode = useCallback(
    async (token: string) => {
      if (verifyingRef.current) return;
      const digits = token.replace(/\D/g, "");
      if (digits.length !== 6) {
        setLocalError(ERROR_COPY.code_invalid);
        return;
      }
      verifyingRef.current = true;
      setVerifying(true);
      setLocalError("");
      try {
        const supabase = createClient();
        const { error } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: digits,
          type: "email",
        });
        if (error) throw error;
        // Session now lives in the browser client (cookie-backed); the
        // server session check on / will redirect the pilot to their bridge.
        window.location.href = next;
      } catch {
        setLocalError(ERROR_COPY.code_failed);
      } finally {
        setVerifying(false);
        verifyingRef.current = false;
      }
    },
    [email, next],
  );

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verifyCode(digits);
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
    <div>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="auth-orb" />
        <div>
          <p className="text-lg font-semibold text-star">{heading}</p>
          <p className="text-xs text-stardust">{subheading}</p>
        </div>
      </div>

      {localError && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-sm leading-relaxed text-neon-amber"
        >
          {localError}
        </p>
      )}

      {step === "code" ? (
        <div className="mt-6">
          <p aria-hidden="true" className="text-3xl">
            ✉️
          </p>
          <p className="mt-2 text-sm font-semibold text-star">Check your email</p>
          <p className="mt-1 text-sm leading-relaxed text-stardust">
            A 6-digit code is on its way to{" "}
            <span className="text-star">{email.trim()}</span>. Type it below —
            it expires soon.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verifyCode(code);
            }}
            className="mt-4"
          >
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stardust">6-digit code</span>
              <input
                type="text"
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                placeholder="000000"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                className="w-full rounded-xl border border-line bg-panel-2 px-4 py-3 text-center text-2xl tracking-[0.5em] text-star placeholder:text-dim focus:border-neon-teal/60 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={verifying || code.length !== 6}
              className="mt-3 w-full rounded-xl border border-neon-teal/50 bg-neon-teal/15 px-4 py-2.5 text-sm font-semibold text-star transition-colors hover:bg-neon-teal/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifying ? "Checking your code…" : "Verify code"}
            </button>
          </form>
          <div className="mt-4 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setLocalError("");
              }}
              className="text-dim underline-offset-2 hover:text-star hover:underline"
            >
              Use a different email
            </button>
            <button
              type="button"
              onClick={sendCode}
              disabled={sending}
              className="text-dim underline-offset-2 hover:text-star hover:underline disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send a fresh code"}
            </button>
          </div>
          <p className="mt-4 text-center text-xs leading-relaxed text-dim">
            The email also includes a one-click sign-in link — either way gets you in.
          </p>
        </div>
      ) : (
        <form onSubmit={sendCode} className="mt-6 space-y-3">
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
            {sending ? "Sending your code…" : "Email me a sign-in code"}
          </button>
          <p className="text-center text-xs text-dim">
            New here? The same code creates your account — no separate sign-up form.
          </p>
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
          <path
            fill="#EA4335"
            d="M12 5.2c1.6 0 3 .6 4.1 1.6l3-3C17.2 2 14.8 1 12 1 7.7 1 3.9 3.5 2 7.1l3.4 2.7C6.3 7.4 8.9 5.2 12 5.2Z"
          />
          <path
            fill="#4285F4"
            d="M23 12.3c0-.9-.1-1.5-.2-2.3H12v4.1h6.3c-.3 1.5-1.3 2.7-2.7 3.5l3.3 2.6C20.8 18.4 23 15.7 23 12.3Z"
          />
          <path
            fill="#FBBC05"
            d="M5.4 14.1c-.3-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1L2 7.1C.7 9.3 0 11.6 0 14s.7 4.7 2 6.9l3.4-2.7c-.3-.7-.4-1.4 0-2.1Z"
            opacity=".9"
          />
          <path
            fill="#34A853"
            d="M12 23c3.2 0 5.9-1.1 7.9-2.9l-3.3-2.6c-.9.6-2.3 1.1-4.6 1.1-3.1 0-5.7-2.2-6.6-4.5L2 16.9C3.9 20.5 7.7 23 12 23Z"
          />
        </svg>
        {googleBusy ? "Opening Google…" : "Continue with Google"}
      </button>

      <style>{AUTH_CSS}</style>
    </div>
  );
}

const AUTH_CSS = `
.auth-orb {
  width: 40px; height: 40px; border-radius: 9999px; display: inline-block; flex-shrink: 0;
  background:
    radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.9) 0%, rgb(255 255 255 / 0) 36%),
    radial-gradient(circle at 50% 55%, #d8fff4 0%, #5eead4 42%, #0e7d6c 78%, #04211c 100%);
  box-shadow: 0 0 16px rgb(94 234 212 / 0.6), 0 0 40px rgb(94 234 212 / 0.25);
}
`;
