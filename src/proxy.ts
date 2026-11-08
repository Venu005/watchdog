import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
// Refresh is persisted here; authorization remains in every server data/action path.
export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const next = () =>
    NextResponse.next({ request: { headers: requestHeaders } });
  let response = next();
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          for (const { name, value } of values)
            request.cookies.set(name, value);
          response = next();
          for (const { name, value, options } of values)
            response.cookies.set(name, value, options);
        },
      },
    },
  );
  await auth.auth.getUser();
  response.headers.set("x-request-id", requestId);
  return response;
}
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/clients/:path*",
    "/monitors/:path*",
    "/settings/:path*",
  ],
};
