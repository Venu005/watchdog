export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironment } = await import("./server/environment");
    const { logger } = await import("./server/logger");
    validateEnvironment("web", process.env);
    logger.info("web.started", { runtime: process.env.NEXT_RUNTIME });
  }
}
