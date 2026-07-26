import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isTestAuthMode, TEST_AUTH_COOKIE } from "../auth";

function loginRedirect(request: NextRequest): NextResponse {
  const destination = request.nextUrl.clone();
  destination.pathname = "/login";
  destination.search = "";
  destination.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(destination);
}

function isProtected(pathname: string): boolean {
  return pathname === "/studio" || pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/projects" || pathname.startsWith("/projects/");
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (!isProtected(request.nextUrl.pathname)) return NextResponse.next();

  if (isTestAuthMode()) {
    const token = request.cookies.get(TEST_AUTH_COOKIE)?.value;
    const authenticated = token?.startsWith("test-user:") && token.length > "test-user:".length;
    return authenticated ? NextResponse.next() : loginRedirect(request);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return loginRedirect(request);

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  return data.user ? response : loginRedirect(request);
}
