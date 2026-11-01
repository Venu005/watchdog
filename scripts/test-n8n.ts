import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { buildN8nWorkflow } from "../src/integrations/n8n";
import { getDb, closeDb } from "../src/server/db";
import { createMonitor, activateMonitor } from "../src/server/monitors";
import { latestOccurrence } from "../src/domain/schedule";
const image =
  "docker.n8n.io/n8nio/n8n@sha256:9a8d8dcea75667496695d7810d7e1fe018a65efb36cc499d347f3931b3957b5d";
const host = process.env.WATCHDOG_DOCKER_HOST ?? "host.docker.internal";
const directory = resolve(".superpowers/n8n-smoke-" + randomUUID());
mkdirSync(directory, { recursive: true });
const log = openSync(".superpowers/n8n-smoke.log", "w");
const container = "watchdog-smoke-" + randomUUID();
const server = spawn(
  "pnpm",
  ["exec", "next", "dev", "--hostname", "0.0.0.0", "--port", "3101"],
  {
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-n8n",
      APP_URL: "http://127.0.0.1:3101",
    },
  },
);
const db = getDb(),
  workspace = randomUUID(),
  client = randomUUID();
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:3101/login");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, "Temporary app server did not start");
  await db`insert into watchdog.workspaces(id,owner_id,owner_email,name) values(${workspace},${randomUUID()},'smoke@example.test','n8n runtime test')`;
  await db`insert into watchdog.clients(id,workspace_id,name) values(${client},${workspace},'Test client')`;
  const config = {
    version: 1,
    schedule: {
      kind: "hourly" as const,
      hour: 0,
      minute: new Date().getUTCMinutes(),
      graceMinutes: 10,
    },
    requiredFields: ["id"],
    minimumCount: 1,
  };
  const monitor = await createMonitor(
    workspace,
    client,
    "n8n runtime check",
    config,
  );
  const occurrence = latestOccurrence(config.schedule, new Date());
  await activateMonitor(
    workspace,
    monitor.id,
    new Date(occurrence.getTime() - 1),
  );
  const credentialId = randomUUID();
  writeFileSync(
    directory + "/credentials.json",
    JSON.stringify([
      {
        id: credentialId,
        name: "Watchdog smoke credential",
        type: "httpHeaderAuth",
        data: { name: "Authorization", value: "Bearer " + monitor.token },
      },
    ]),
  );
  const workflows = [
    ["zero", false, []],
    ["success", false, [{ id: "example-lead" }]],
    ["synthetic", true, [{ id: "example-lead" }]],
  ] as const;
  const ids: string[] = [];
  const flows = workflows.map(([label, isTest, records]) => {
    const flow = buildN8nWorkflow(
      monitor.id,
      config,
      "http://" + host + ":3101",
    );
    const id = randomUUID();
    ids.push(id);
    const first = flow.nodes[0];
    first.type = "n8n-nodes-base.manualTrigger";
    first.typeVersion = 1;
    first.parameters = {} as typeof first.parameters;
    if (label !== "synthetic")
      flow.nodes[1].parameters = {
        jsCode: `return [{json:${JSON.stringify({ event_id: "runtime-" + label, config_version: 1, scheduled_for: occurrence.toISOString(), is_test: isTest })}}];`,
      } as typeof first.parameters;
    flow.nodes[2].parameters = {
      jsCode: `return [{json:{records:${JSON.stringify(records)}}}];`,
    } as typeof first.parameters;
    const send = flow.nodes[4];
    Object.assign(send, {
      credentials: {
        httpHeaderAuth: { id: credentialId, name: "Watchdog smoke credential" },
      },
    });
    if (label === "success") {
      const retry = {
        ...send,
        id: "retry-send",
        name: "Replay same signal",
        position: [1200, 0],
        parameters: {
          ...send.parameters,
          jsonBody: '={{ JSON.stringify($("Build outcome").first().json) }}',
        },
      };
      flow.nodes.push(retry);
      Object.assign(flow.connections, {
        "Report to Watchdog": {
          main: [[{ node: "Replay same signal", type: "main", index: 0 }]],
        },
      });
    }
    return { ...flow, id, versionId: randomUUID() };
  });
  writeFileSync(directory + "/workflows.json", JSON.stringify(flows));
  const command =
    "n8n import:credentials --input=/fixtures/credentials.json && n8n import:workflow --input=/fixtures/workflows.json && " +
    ids.map((id) => "n8n execute --id=" + id).join(" && ");
  await new Promise<void>((ok, fail) => {
    const p = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        container,
        "-v",
        directory + ":/fixtures:ro",
        "-e",
        "N8N_DIAGNOSTICS_ENABLED=false",
        "-e",
        "N8N_VERSION_NOTIFICATIONS_ENABLED=false",
        "-e",
        "N8N_TEMPLATES_ENABLED=false",
        "--entrypoint",
        "sh",
        image,
        "-c",
        command,
      ],
      { stdio: ["ignore", log, log] },
    );
    p.once("error", fail);
    p.once("exit", (code) =>
      code === 0
        ? ok()
        : fail(
            new Error("n8n runtime failed; inspect .superpowers/n8n-smoke.log"),
          ),
    );
  });
  const events =
    await db`select event_id,record_count,kind,is_test from watchdog.signals where monitor_id=${monitor.id} order by received_at`;
  assert.equal(
    events.length,
    3,
    "Duplicate HTTP report must not create an extra signal",
  );
  assert.equal(events[0].record_count, 0);
  assert.equal(events[0].kind, "fail");
  assert.equal(events[1].kind, "pass");
  assert.equal(events[2].kind, "test");
  const [state] =
    await db`select status from watchdog.monitors where id=${monitor.id}`;
  assert.equal(
    state.status,
    "healthy",
    "Synthetic test must not replace the last production result",
  );
  console.log(
    "PASS n8n 2.45.7: real Header Auth + HTTP node, zero-output failure, success/recovery, duplicate replay, synthetic isolation.",
  );
} finally {
  server.kill("SIGTERM");
  try {
    execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  } catch {}
  await db`delete from watchdog.workspaces where id=${workspace}`;
  await closeDb();
  rmSync(directory, { recursive: true, force: true });
  closeSync(log);
}
