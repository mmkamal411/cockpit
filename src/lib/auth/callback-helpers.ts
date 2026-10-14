/** Pure helpers for /auth/callback — framework-free so they can be unit-tested. */

/** Allow only same-origin post-auth destinations. */
export function safePostAuthNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

export type AuthFailureCode = "auth" | "auth_expired" | "auth_pkce";

/** Map a Supabase code-exchange failure to a login ?error= code. */
export function authFailureCode(message: string): AuthFailureCode {
  const m = message.toLowerCase();
  if (m.includes("expired") || m.includes("invalid_grant") || m.includes("invalid grant")) {
    return "auth_expired";
  }
  if (m.includes("code verifier") || m.includes("pkce")) {
    return "auth_pkce";
  }
  return "auth";
}
