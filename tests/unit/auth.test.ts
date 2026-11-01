import { it, expect } from "vitest";
import { resolveWorkspace } from "../../src/server/auth-context";
it("rejects an absent session before exposing workspace data", async () => {
  await expect(
    resolveWorkspace(
      async () => null,
      async () => ({ id: "workspace" }),
    ),
  ).rejects.toThrow("Sign in");
});
it("rejects a valid user without a provisioned workspace", async () => {
  await expect(
    resolveWorkspace(
      async () => ({ id: "user" }),
      async () => null,
    ),
  ).rejects.toThrow("provisioned");
});
it("returns only the workspace owned by the verified identity", async () => {
  const result = await resolveWorkspace(
    async () => ({ id: "user-a" }),
    async (id) => (id === "user-a" ? { id: "workspace-a" } : null),
  );
  expect(result).toEqual({ userId: "user-a", workspaceId: "workspace-a" });
});
