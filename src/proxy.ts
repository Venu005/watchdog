import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
// Refresh is persisted here; authorization remains in every server data/action path.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          for (const { name, value } of values)
            request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of values)
            response.cookies.set(name, value, options);
        },
      },
    },
  );
  await auth.auth.getUser();
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
