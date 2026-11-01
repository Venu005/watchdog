export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironment } = await import("./server/environment");
    validateEnvironment("web", process.env);
  }
}
