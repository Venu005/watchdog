export function validateEnvironment(
  role: "web" | "worker",
  env: Record<string, string | undefined>,
) {
  const required = [
    "DATABASE_URL",
    "APP_URL",
    "CREDENTIAL_ENCRYPTION_KEY",
    ...(role === "web"
      ? ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
      : []),
  ];
  for (const key of required)
    if (!env[key]) throw new Error("Missing required configuration: " + key);
  if (!/^[a-f0-9]{64}$/i.test(env.CREDENTIAL_ENCRYPTION_KEY!))
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as hex",
    );
  for (const key of [
    "APP_URL",
    ...(role === "web" ? ["NEXT_PUBLIC_SUPABASE_URL"] : []),
  ]) {
    try {
      const url = new URL(env[key]!);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      throw new Error("Invalid URL configuration: " + key);
    }
  }
}
