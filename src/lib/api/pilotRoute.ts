import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Wrapper for pilot-level API routes.
 *
 * - Builds the SSR Supabase client from the request cookies.
 * - Rejects unauthenticated callers with a plain-English 401.
 * - Passes the supabase client and the pilot's user id to the handler.
 *
 * Row-level security does the authorization: every bills-table policy is
 * owner-only (auth.uid() = pilot_id), so a pilot can only ever touch
 * their own rows even if a handler has a bug.
 *
 * Every error the pilot sees is plain English (grandmother test).
 */

export interface PilotContext {
  supabase: SupabaseClient;
  pilotId: string;
}

type PilotHandler = (
  ctx: PilotContext,
  req: NextRequest,
  routeParams: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Map a Supabase/Postgres error to a plain-English message + status. */
export function dbErrorMessage(error: { message: string; code?: string }): {
  message: string;
  status: number;
} {
  const code = error.code ?? "";
  if (code === "23503") {
    return { message: "That record doesn't exist anymore.", status: 404 };
  }
  if (code === "23502" || code === "23514" || code === "22P02") {
    return { message: "Something in that request wasn't filled in right.", status: 400 };
  }
  // RLS denial or anything else — never leak internals.
  return { message: "Something went wrong on our side. Try again.", status: 500 };
}

export function pilotRoute(handler: PilotHandler) {
  return async (
    req: NextRequest,
    routeParams: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    let supabase: SupabaseClient;
    try {
      supabase = await createClient();
    } catch {
      return jsonError("We couldn't reach your account right now. Try again.", 503);
    }

    let pilotId: string;
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) {
        return jsonError("You're signed out. Sign in and try again.", 401);
      }
      pilotId = user.id;
    } catch {
      return jsonError("We couldn't confirm who you are. Sign in and try again.", 401);
    }

    try {
      return await handler({ supabase, pilotId }, req, routeParams);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      // Handlers throw plain-English Errors for expected cases; anything
      // else becomes a generic 500 without leaking internals.
      const status = message.startsWith("DB:") ? 500 : 400;
      const clean = message.startsWith("DB:") ? message.slice(3) : message;
      return jsonError(clean || "Something went wrong on our side. Try again.", status);
    }
  };
}

/** Throw this from a handler for a 404 with a plain-English message. */
export class NotFoundError extends Error {}
/** Throw this from a handler for a 400 with a plain-English message. */
export class BadRequestError extends Error {}
