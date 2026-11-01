import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveWorkspace } from "./auth-context";
import { findWorkspaceForUser } from "./auth-store";
export async function authClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll(items) {
          try {
            items.forEach(({ name, value, options }) =>
              store.set(name, value, options),
            );
          } catch {
            /* Render-only paths cannot set cookies; callback/actions refresh sessions. */
          }
        },
      },
    },
  );
}
export async function requireWorkspace() {
  const client = await authClient();
  return resolveWorkspace(async () => {
    const { data, error } = await client.auth.getUser();
    return error ? null : data.user;
  }, findWorkspaceForUser);
}

export async function workspaceForPage() {
  try {
    return await requireWorkspace();
  } catch {
    const { redirect } = await import("next/navigation");
    return redirect("/login");
  }
}
