import { ingestSignal } from "../../../../server/ingest";
import { readBoundedJson } from "../../../../server/http";
import { ServiceError } from "../../../../server/errors";
import { rateLimit } from "../../../../server/rate-limit";
import { logger } from "../../../../server/logger";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ monitorId: string }> },
) {
  const { monitorId } = await params;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const log = logger.child({
    requestId,
    route: "api.ingest",
    monitorId,
  });
  try {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ") || authorization.length > 256)
      throw new ServiceError(401, "Unauthorized");
    if (process.env.TRUSTED_PROXY === "true") {
      const ip = request.headers.get("x-real-ip");
      if (ip && /^[a-fA-F0-9:.]{3,64}$/.test(ip))
        await rateLimit("ip:" + ip, 240);
    }
    const body = await readBoundedJson(request);
    const result = await ingestSignal(monitorId, authorization.slice(7), body);
    log.info("ingest.accepted", { outcome: result.kind });
    return Response.json(
      { ok: true, result },
      { headers: { "x-request-id": requestId } },
    );
  } catch (e) {
    const status = e instanceof ServiceError ? e.status : 503;
    if (status >= 500) log.error("ingest.failed", e, { status });
    else
      log.warn("ingest.rejected", {
        status,
        reason: e instanceof ServiceError ? e.message : "unknown",
      });
    return Response.json(
      {
        ok: false,
        error:
          e instanceof ServiceError
            ? e.message
            : "Service temporarily unavailable",
      },
      {
        status,
        headers: {
          ...(status === 429 ? { "Retry-After": "60" } : {}),
          "x-request-id": requestId,
        },
      },
    );
  }
}
