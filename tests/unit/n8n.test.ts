import { it, expect } from "vitest";
import { buildN8nWorkflow } from "../../src/integrations/n8n";
import { config } from "../helpers/fixture";
it("generates an importable UTC workflow with a safe synthetic default", () => {
  const flow = buildN8nWorkflow("monitor", config, "https://watchdog.example");
  expect(flow.settings).toMatchObject({ timezone: "UTC" });
  expect(flow.active).toBe(false);
  expect(Array.isArray(flow.nodes)).toBe(true);
});
it("reports a missing required field as absent rather than the valid scalar false", () => {
  const flow = buildN8nWorkflow("monitor", config, "https://watchdog.example");
  const code = flow.nodes.find((n) => n.name === "Build outcome")!.parameters
    .jsCode as string;
  const run = new Function("$input", "$", code);
  const output = run({ first: () => ({ json: { records: [{}] } }) }, () => ({
    first: () => ({
      json: {
        event_id: "run",
        config_version: 1,
        scheduled_for: "2026-11-02T09:00:00Z",
        is_test: false,
      },
    }),
  }));
  expect(output[0].json.fields.lead_id).toBeNull();
});
