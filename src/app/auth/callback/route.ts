import { authClient } from "../../../server/auth";
import { getDb } from "../../../server/db";
import { logger } from "../../../server/logger";
export async function GET(request: Request) {
  const log = logger.child({
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    route: "auth.callback",
  });
  try {
    const code = new URL(request.url).searchParams.get("code");
    if (code) {
      const auth = await authClient();
      const { error } = await auth.auth.exchangeCodeForSession(code);
      if (!error) {
        const { data } = await auth.auth.getUser();
        if (data.user?.email && data.user.email_confirmed_at)
          await getDb()`update watchdog.workspaces set owner_email=${data.user.email.toLowerCase()} where owner_id=${data.user.id}`;
        log.info("auth.callback_succeeded");
        return Response.redirect(new URL("/dashboard", process.env.APP_URL));
      }
      log.warn("auth.callback_rejected", { reason: error.message });
    }
  } catch (error) {
    log.error("auth.callback_failed", error);
  }
  log.warn("auth.callback_expired");
  return Response.redirect(
    new URL("/login?error=expired", process.env.APP_URL),
  );
}
