import { it, expect } from "vitest";
import { validateEnvironment } from "../../src/server/environment";
it("rejects missing worker configuration instead of silently looping", () => {
  expect(() => validateEnvironment("worker", {})).toThrow("DATABASE_URL");
});
it("requires a valid encryption key before accepting startup", () => {
  expect(() =>
    validateEnvironment("worker", {
      DATABASE_URL: "postgres://server/database",
      APP_URL: "https://watchdog.example",
      CREDENTIAL_ENCRYPTION_KEY: "short",
    }),
  ).toThrow("CREDENTIAL_ENCRYPTION_KEY");
});
it("accepts an explicitly configured worker without AI or operator keys", () => {
  expect(() =>
    validateEnvironment("worker", {
      DATABASE_URL: "postgres://server/database",
      APP_URL: "https://watchdog.example",
      CREDENTIAL_ENCRYPTION_KEY: "ab".repeat(32),
    }),
  ).not.toThrow();
});
