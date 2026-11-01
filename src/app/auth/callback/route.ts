import { authClient } from "../../../server/auth";
import { getDb } from "../../../server/db";
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (code) {
    const auth = await authClient();
    const { error } = await auth.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await auth.auth.getUser();
      if (data.user?.email && data.user.email_confirmed_at)
        await getDb()`update watchdog.workspaces set owner_email=${data.user.email.toLowerCase()} where owner_id=${data.user.id}`;
      return Response.redirect(new URL("/dashboard", process.env.APP_URL));
    }
  }
  return Response.redirect(
    new URL("/login?error=expired", process.env.APP_URL),
  );
}
