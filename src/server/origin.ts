import { ServiceError } from "./errors";
export function assertSameOrigin(origin: string | null, appUrl: string) {
  if (origin !== new URL(appUrl).origin)
    throw new ServiceError(403, "Untrusted request origin");
}
