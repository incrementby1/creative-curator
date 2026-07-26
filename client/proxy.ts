import type { NextRequest } from "next/server";
import { updateSession } from "./app/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/studio/:path*", "/settings/:path*", "/projects/:path*"],
};
