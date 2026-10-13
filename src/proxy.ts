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
  const { response, user } = await updateSession(request);
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
