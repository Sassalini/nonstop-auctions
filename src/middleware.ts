import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // These endpoints read anonymous public catalogue data and never consume a session.
  // Avoid a remote auth lookup on each live-navigation refresh.
  if (request.nextUrl.pathname === "/api/live-lots" || /^\/api\/rooms\/[a-z0-9-]+\/catalogue$/.test(request.nextUrl.pathname)) return NextResponse.next();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !request.cookies.getAll().some(cookie => cookie.name.startsWith("sb-"))) {
    return NextResponse.next();
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // Verify remotely; never use an unverified client session to authorize a page.
  await supabase.auth.getUser();
  // Photo responses set their own private/public-visible browser cache policy.
  if (!request.nextUrl.pathname.startsWith("/api/lot-photos/")) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|images|favicon.ico).*)"],
};
