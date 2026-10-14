"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Catches any unhandled throw in pages/layouts
 * under src/app and shows a plain-English recovery screen — never a blank
 * page, never framework jargon.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        route: "app/error-boundary",
        operation: "render",
        error: error.message,
        digest: error.digest,
        timestamp: new Date().toISOString(),
      }),
    );
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#050807",
        color: "#e8f5e9",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: "28rem", textAlign: "center" }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔥</div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
          Something went wrong
        </h1>
        <p style={{ opacity: 0.75, marginBottom: "1.5rem", lineHeight: 1.6 }}>
          The cockpit hit a bump. Your data is safe — nothing was lost.
          {error.digest && (
            <>
              <br />
              <span style={{ fontSize: "0.8rem", opacity: 0.6 }}>
                Reference: {error.digest}
              </span>
            </>
          )}
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
          <button
            onClick={reset}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "0.5rem",
              border: "1px solid #2e7d32",
              background: "#1b5e20",
              color: "#fff",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            Try again
          </button>
          <a
            href="/home"
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "0.5rem",
              border: "1px solid #444",
              color: "#e8f5e9",
              textDecoration: "none",
              fontSize: "1rem",
            }}
          >
            Go home
          </a>
        </div>
      </div>
    </main>
  );
}
