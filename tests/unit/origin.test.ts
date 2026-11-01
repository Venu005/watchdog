import { it, expect } from "vitest";
import { assertSameOrigin } from "../../src/server/origin";
it("accepts the exact configured application origin", () => {
  expect(() =>
    assertSameOrigin("https://watchdog.example", "https://watchdog.example"),
  ).not.toThrow();
});
it.each([
  null,
  "https://evil.example",
  "https://watchdog.example.evil.test",
  "http://watchdog.example",
])("rejects a cross-origin or absent Origin %s", (origin) => {
  expect(() => assertSameOrigin(origin, "https://watchdog.example")).toThrow(
    "Untrusted",
  );
});
