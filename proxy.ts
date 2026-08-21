import { NextRequest, NextResponse } from "next/server";
import { sessionCookie, verifySession } from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production" && process.env.DEMO_AUTH_BYPASS === "true") return NextResponse.next();
  const valid = await verifySession(request.cookies.get(sessionCookie.name)?.value);
  if (valid) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|api/slack/events|_next/static|_next/image|favicon.ico).*)"],
};
