import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Edge gate for the ship. Refreshes the Supabase session, then enforces
 * the only two auth rules the cockpit has:
 *  - the ship (/home) is for signed-in pilots — everyone else goes to /login
 *  - signed-in pilots never see the public pages — / and /login send them
 *    straight to their bridge
 */
export async function proxy(request: NextRequest) {
  let response: NextResponse;
  let user: { id: string } | null;
  try {
    ({ response, user } = await updateSession(request));
  } catch (e) {
    // The session refresh is a best-effort gate, never a load-bearing wall.
    // If Supabase is unreachable or the session check throws, fail OPEN:
    // let the request through so the pilot never sees a 500 on every page
    // (including /login) during an auth-service blip. /home's own server
    // component re-checks auth and redirects when truly signed out.
    console.error(JSON.stringify({
      route: "proxy",
      operation: "updateSession",
      pathname: request.nextUrl.pathname,
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    }));
    return NextResponse.next({ request });
  }
  const { pathname } = request.nextUrl;

  if (!user && pathname.startsWith("/home")) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    return NextResponse.redirect(login);
  }

  if (user && (pathname === "/" || pathname === "/login")) {
    const home = request.nextUrl.clone();
    home.pathname = "/home";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|videos/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
