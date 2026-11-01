import { it, expect } from "vitest";
import { readBoundedJson } from "../../src/server/http";
it("reads a bounded JSON body", async () => {
  expect(
    await readBoundedJson(
      new Request("http://localhost", { method: "POST", body: '{"ok":true}' }),
    ),
  ).toEqual({ ok: true });
});
it("rejects large streaming payloads even without content length", async () => {
  await expect(
    readBoundedJson(
      new Request("http://localhost", {
        method: "POST",
        body: "x".repeat(16385),
      }),
    ),
  ).rejects.toThrow("16 KB");
});
it("rejects malformed JSON without exposing its body", async () => {
  await expect(
    readBoundedJson(
      new Request("http://localhost", {
        method: "POST",
        body: "private-customer-data",
      }),
    ),
  ).rejects.toThrow("Invalid JSON");
});
