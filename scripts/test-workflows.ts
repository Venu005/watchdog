import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, rmSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "@playwright/test";
import { buildN8nWorkflow, type N8nNode } from "../src/integrations/n8n";
import { getDb, closeDb } from "../src/server/db";
import { createMonitor, activateMonitor } from "../src/server/monitors";
assert.equal(
  process.env.EMAIL_TRANSPORT,
  "local",
  "Workflow QA requires local email transport",
);
const image =
  "docker.n8n.io/n8nio/n8n@sha256:9a8d8dcea75667496695d7810d7e1fe018a65efb36cc499d347f3931b3957b5d";
const qa = resolve(".superpowers/qa-navigation-workflows");
mkdirSync(qa, { recursive: true });
const directory = qa + "/fixtures-" + randomUUID();
mkdirSync(directory);
const log = openSync(qa + "/scheduled-n8n.log", "w");
const container = "watchdog-acceptance-" + randomUUID();
const db = getDb(),
  workspace = randomUUID(),
  client = randomUUID();
const ownerEmail = "workflow-qa-" + Date.now() + "@example.test";
const auth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
let ownerId: string | undefined,
  browser: Browser | undefined,
  page: Page | undefined;
let upstreamHits = 0;
const upstream = createServer((_req, res) => {
  upstreamHits++;
  res.writeHead(503, { "content-type": "application/json" });
  res.end('{"error":"intentional QA upstream outage"}');
});
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "0.0.0.0",
    "--port",
    "3101",
  ],
  {
    stdio: ["ignore", log, log],
    detached: true,
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-n8n",
      APP_URL: "http://127.0.0.1:3101",
    },
  },
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(
  check: () => Promise<boolean>,
  timeout: number,
  label: string,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(1000);
  }
  throw new Error("Timed out: " + label);
}
async function docker(args: string[]) {
  await new Promise<void>((ok, fail) => {
    const p = spawn("docker", args, { stdio: ["ignore", log, log] });
    p.once("error", fail);
    p.once("exit", (c) =>
      c === 0
        ? ok()
        : fail(new Error("n8n command failed; inspect scheduled-n8n.log")),
    );
  });
}
function executions() {
  try {
    return JSON.parse(
      execFileSync(
        "docker",
        [
          "exec",
          container,
          "node",
          "-e",
          `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});const rows=db.prepare('select id,workflowId,status,startedAt,stoppedAt from execution_entity').all();for(const row of rows){const d=db.prepare('select data from execution_data where executionId=?').get(row.id);const raw=String(d?.data??'');row.codeFailure=raw.includes('WATCHDOG_QA_INTENTIONAL_CODE_FAILURE');row.http503=raw.includes('503');row.unauthorized=raw.includes('401')&&raw.includes('Unauthorized');}console.log(JSON.stringify(rows));`,
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 4000,
        },
      ),
    ) as {
      id: string;
      workflowId: string;
      status: string;
      codeFailure: boolean;
      http503: boolean;
      unauthorized: boolean;
    }[];
  } catch {
    return [];
  }
}
const kinds = [
  "empty",
  "missing-field",
  "code-error",
  "http-503",
  "bad-token",
  "disabled",
  "healthy",
] as const;
type Case = (typeof kinds)[number];
const scenarios: {
  kind: Case;
  monitorId: string;
  workflowId: string;
  credentialId: string;
  flow: ReturnType<typeof buildN8nWorkflow>;
}[] = [];
async function captured(subject: string) {
  const result = await fetch(
    process.env.LOCAL_MAIL_URL +
      "/api/v1/search?query=" +
      encodeURIComponent("to:" + ownerEmail),
  );
  const body = await result.json();
  return (body.messages ?? []).filter((m: { Subject: string }) =>
    m.Subject.startsWith(subject),
  ).length;
}
async function screenshotStage(stage: string) {
  if (!browser) {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto("http://127.0.0.1:3100/login");
    await page.getByLabel("Work email").fill(ownerEmail);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await page.getByText("If your workspace is provisioned").waitFor();
    let id = "";
    await until(
      async () => {
        const body = await (
          await fetch(
            process.env.LOCAL_MAIL_URL +
              "/api/v1/search?query=" +
              encodeURIComponent("to:" + ownerEmail),
          )
        ).json();
        id =
          body.messages?.find(
            (m: { Subject: string }) => m.Subject === "Your sign-in link",
          )?.ID ?? "";
        return Boolean(id);
      },
      10000,
      "QA sign-in email",
    );
    const message = await (
      await fetch(process.env.LOCAL_MAIL_URL + "/api/v1/message/" + id)
    ).json();
    const url = String(message.HTML).match(
      /href="([^"]*\/auth\/v1\/verify[^"]*)"/,
    )?.[1];
    assert.ok(url);
    await page.goto(url.replaceAll("&amp;", "&"));
    await page
      .getByRole("heading", { name: "Your monitoring workspace" })
      .waitFor();
  }
  await page!.goto("http://127.0.0.1:3100/dashboard");
  await page!.screenshot({
    path: qa + "/" + stage + "-overview.png",
    fullPage: true,
  });
  await page!
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("link", { name: "Clients", exact: true })
    .click();
  await page!.getByRole("heading", { name: "Clients", exact: true }).waitFor();
  await page!.screenshot({
    path: qa + "/" + stage + "-clients.png",
    fullPage: true,
  });
  await page!
    .getByRole("link", { name: "Runtime workflow QA", exact: true })
    .click();
  await page!
    .getByRole("heading", { name: "Runtime workflow QA", exact: true })
    .waitFor();
  await page!.screenshot({
    path: qa + "/" + stage + "-client-monitors.png",
    fullPage: true,
  });
}
try {
  await new Promise<void>((ok) => upstream.listen(0, "0.0.0.0", ok));
  const port = (upstream.address() as { port: number }).port;
  await until(
    async () => {
      try {
        return (await fetch("http://127.0.0.1:3101/login")).ok;
      } catch {
        return false;
      }
    },
    30000,
    "temporary app",
  );
  assert.equal(
    (await fetch("http://127.0.0.1:3100/api/health")).status,
    200,
    "The real app worker must be healthy",
  );
  const created = await auth.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  ownerId = created.data.user!.id;
  await db`insert into watchdog.workspaces(id,owner_id,owner_email,name,monitor_limit) values(${workspace},${ownerId},${ownerEmail},'Scheduled workflow QA',10)`;
  await db`insert into watchdog.clients(id,workspace_id,name) values(${client},${workspace},'Runtime workflow QA')`;
  const occurrence = new Date(Math.ceil((Date.now() + 90000) / 60000) * 60000);
  const deadline = new Date(occurrence.getTime() + 60000);
  const config = {
    version: 1,
    schedule: {
      kind: "hourly" as const,
      hour: 0,
      minute: occurrence.getUTCMinutes(),
      graceMinutes: 1,
    },
    requiredFields: ["id"],
    minimumCount: 1,
  };
  const credentials: {
    id: string;
    name: string;
    type: string;
    data: { name: string; value: string };
  }[] = [];
  for (const kind of kinds) {
    const m = await createMonitor(workspace, client, "QA " + kind, config);
    await activateMonitor(workspace, m.id);
    const credentialId = randomUUID();
    credentials.push({
      id: credentialId,
      name: "QA " + kind,
      type: "httpHeaderAuth",
      data: { name: "Authorization", value: "Bearer " + m.token },
    });
    const flow = buildN8nWorkflow(
      m.id,
      config,
      "http://" +
        (process.env.WATCHDOG_DOCKER_HOST ?? "host.docker.internal") +
        ":3101",
    );
    flow.nodes[1].parameters.jsCode = String(
      flow.nodes[1].parameters.jsCode,
    ).replace("is_test:true", "is_test:false");
    const send = flow.nodes.find((n) => n.name === "Report to Watchdog")!;
    send.credentials = {
      httpHeaderAuth: { id: credentialId, name: "QA " + kind },
    };
    const startBody: N8nNode = {
      id: "start-body",
      name: "Build start marker",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [300, -180],
      parameters: {
        jsCode: `const meta = $('Capture run').first().json; return [{json:{...meta,event_id:'started-'+meta.event_id,is_test:true,record_count:1,fields:{id:true}}}];`,
      },
    };
    const start: N8nNode = {
      ...structuredClone(send),
      id: "started",
      name: "Mark run started",
      position: [360, -180],
    };
    flow.nodes.push(startBody, start);
    Object.assign(flow.connections, {
      "Capture run": {
        main: [[{ node: "Build start marker", type: "main", index: 0 }]],
      },
      "Build start marker": {
        main: [[{ node: "Mark run started", type: "main", index: 0 }]],
      },
      "Mark run started": {
        main: [[{ node: "Business action", type: "main", index: 0 }]],
      },
    });
    const business = flow.nodes.find((n) => n.name === "Business action")!;
    business.parameters = {
      jsCode:
        kind === "code-error"
          ? "throw new Error('WATCHDOG_QA_INTENTIONAL_CODE_FAILURE');"
          : `return [{json:{records:${kind === "empty" ? "[]" : kind === "missing-field" ? "[{}]" : '[{id:"qa-lead"}]'}}}];`,
    };
    if (kind === "http-503") {
      business.type = "n8n-nodes-base.httpRequest";
      business.typeVersion = 4.2;
      business.parameters = {
        method: "GET",
        url:
          "http://" +
          (process.env.WATCHDOG_DOCKER_HOST ?? "host.docker.internal") +
          ":" +
          port +
          "/intentional-error",
        options: { timeout: 5000 },
      };
      business.retryOnFail = true;
      business.maxTries = 2;
      business.waitBetweenTries = 1000;
    }
    if (kind === "bad-token") {
      const bad = randomUUID();
      credentials.push({
        id: bad,
        name: "Intentionally invalid QA token",
        type: "httpHeaderAuth",
        data: { name: "Authorization", value: "Bearer intentionally-invalid" },
      });
      send.credentials = {
        httpHeaderAuth: { id: bad, name: "Intentionally invalid QA token" },
      };
    }
    scenarios.push({
      kind,
      monitorId: m.id,
      workflowId: randomUUID(),
      credentialId,
      flow,
    });
  }
  writeFileSync(directory + "/credentials.json", JSON.stringify(credentials));
  writeFileSync(
    directory + "/workflows.json",
    JSON.stringify(
      scenarios.map((s) => ({
        ...s.flow,
        id: s.workflowId,
        name: "QA " + s.kind,
        versionId: randomUUID(),
      })),
    ),
  );
  const publish = scenarios
    .filter((s) => s.kind !== "disabled")
    .map((s) => "n8n publish:workflow --id=" + s.workflowId)
    .join(" && ");
  const command =
    "n8n import:credentials --input=/fixtures/credentials.json && n8n import:workflow --input=/fixtures/workflows.json && " +
    publish +
    " && n8n start";
  await docker([
    "run",
    "-d",
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
    "-e",
    "EXECUTIONS_DATA_SAVE_ON_ERROR=all",
    "-e",
    "EXECUTIONS_DATA_SAVE_ON_SUCCESS=all",
    "--entrypoint",
    "sh",
    image,
    "-c",
    command,
  ]);
  console.log(
    "Published six real UTC schedules; seventh workflow deliberately disabled.",
  );
  console.log(
    "Scheduled occurrence: " +
      occurrence.toISOString() +
      "; grace deadline: " +
      deadline.toISOString(),
  );
  await until(
    async () => {
      const rows =
        await db`select id,status from watchdog.monitors where workspace_id=${workspace}`;
      return (
        rows.length === 7 &&
        rows.every(
          (m) =>
            m.status ===
            (m.id === scenarios.find((s) => s.kind === "healthy")!.monitorId
              ? "healthy"
              : "failing"),
        )
      );
    },
    Math.max(1, deadline.getTime() - Date.now()) + 100000,
    "all real failure detections",
  );
  const n8nRuns = executions();
  const incidents =
    await db`select i.monitor_id,i.reason,i.opened_at from watchdog.incidents i join watchdog.monitors m on m.id=i.monitor_id where m.workspace_id=${workspace} and i.status='open'`;
  const cases = [];
  for (const s of scenarios) {
    const runs = n8nRuns.filter((e) => e.workflowId === s.workflowId);
    const incident = incidents.find((i) => i.monitor_id === s.monitorId);
    if (s.kind === "healthy") {
      assert.equal(runs[0]?.status, "success");
      assert.equal(incident, undefined);
    } else {
      assert.ok(incident, "Missing incident for " + s.kind);
      const reason = ["empty", "missing-field"].includes(s.kind)
        ? "output-validation"
        : "missed-run";
      assert.equal(
        incident.reason,
        reason,
        s.kind + " incident classification",
      );
      if (reason === "missed-run")
        assert.ok(
          new Date(incident.opened_at).getTime() >= deadline.getTime(),
          "Missed-run must respect real grace",
        );
    }
    if (s.kind === "disabled") assert.equal(runs.length, 0);
    else {
      assert.equal(
        runs.length,
        1,
        "Exactly one scheduled execution for " + s.kind,
      );
      assert.equal(
        runs[0].status,
        ["code-error", "http-503", "bad-token"].includes(s.kind)
          ? "error"
          : "success",
      );
      const [marker] =
        await db`select count(*)::int as total from watchdog.signals where monitor_id=${s.monitorId} and is_test=true`;
      assert.equal(
        marker.total,
        1,
        "Real run-start marker must arrive for " + s.kind,
      );
    }
    if (s.kind === "code-error")
      assert.ok(
        runs[0].codeFailure,
        "Actual n8n execution must contain the deliberate exception",
      );
    if (s.kind === "http-503")
      assert.ok(runs[0].http503, "Actual n8n execution must contain HTTP 503");
    if (s.kind === "bad-token")
      assert.ok(
        runs[0].unauthorized,
        "Actual n8n execution must contain unauthorized reporting error",
      );
    cases.push({
      scenario: s.kind,
      n8nStatus: runs[0]?.status ?? "not-executed",
      detectedAs: incident?.reason ?? "healthy",
      detectedAt: incident?.opened_at ?? null,
    });
  }
  assert.ok(upstreamHits >= 2, "Actual HTTP upstream retry must happen");
  await until(
    async () => (await captured("Action needed:")) === 6,
    30000,
    "six captured failure emails",
  );
  console.log(
    "Detected all six failures. Captured six failure emails. Healthy control remained healthy.",
  );
  await screenshotStage("failures");
  const recovery = scenarios
    .filter((s) => s.kind !== "healthy")
    .map((s) => {
      const flow = structuredClone(s.flow);
      const trigger = flow.nodes[0];
      trigger.type = "n8n-nodes-base.manualTrigger";
      trigger.typeVersion = 1;
      trigger.parameters = {};
      const business = flow.nodes.find((n) => n.name === "Business action")!;
      business.type = "n8n-nodes-base.code";
      business.typeVersion = 2;
      business.parameters = {
        jsCode: 'return [{json:{records:[{id:"recovered-lead"}]}}];',
      };
      flow.nodes.find((n) => n.name === "Report to Watchdog")!.credentials = {
        httpHeaderAuth: { id: s.credentialId, name: "QA " + s.kind },
      };
      return {
        ...flow,
        id: s.workflowId,
        name: "QA " + s.kind + " repaired",
        versionId: randomUUID(),
      };
    });
  writeFileSync(directory + "/recovery.json", JSON.stringify(recovery));
  await docker([
    "exec",
    container,
    "sh",
    "-c",
    "n8n import:workflow --input=/fixtures/recovery.json && " +
      recovery
        .map((f) => "N8N_RUNNERS_BROKER_PORT=5689 n8n execute --id=" + f.id)
        .join(" && "),
  ]);
  await until(
    async () => {
      const [row] =
        await db`select count(*)::int as total from watchdog.monitors where workspace_id=${workspace} and status='healthy'`;
      return row.total === 7;
    },
    30000,
    "recovered monitor state",
  );
  await until(
    async () => (await captured("Recovered:")) === 6,
    30000,
    "six captured recovery emails",
  );
  const transitions =
    await db`select j.monitor_id,j.payload->>'transition' as transition,count(*)::int as total from watchdog.jobs j join watchdog.monitors m on m.id=j.monitor_id where m.workspace_id=${workspace} and j.kind='email' group by j.monitor_id,j.payload->>'transition'`;
  assert.equal(
    transitions.length,
    12,
    "Exactly one failure and recovery transition for each broken monitor",
  );
  assert.ok(
    transitions.every((t) => t.total === 1),
    "No duplicate alert jobs",
  );
  await screenshotStage("recovered");
  writeFileSync(
    qa + "/workflow-results.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        n8nVersion: "2.45.7",
        actualScheduledOccurrence: occurrence.toISOString(),
        actualGraceDeadline: deadline.toISOString(),
        cases,
        upstream503Requests: upstreamHits,
        capturedFailureEmails: 6,
        capturedRecoveryEmails: 6,
        allSevenMonitorsRecovered: true,
        duplicateTransitions: 0,
        limitations: [
          "Hard execution failures are detected as missed completed outcomes after grace, not immediate n8n exception details.",
          "Google Sheets and external email providers were not used; alerts were captured in the real local Mailpit inbox.",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS scheduled workflow acceptance: 7 cases, 6 failures detected, 6 recoveries, 12 captured alert emails, zero duplicate transitions.",
  );
} catch (error) {
  try {
    execFileSync("docker", ["logs", container], {
      stdio: ["ignore", log, log],
    });
  } catch {}
  throw error;
} finally {
  if (browser) await browser.close();
  try {
    execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
  } catch {}
  if (app.pid) {
    try {
      process.kill(-app.pid, "SIGTERM");
    } catch {}
  }
  await new Promise<void>((ok) => upstream.close(() => ok()));
  await db`delete from watchdog.workspaces where id=${workspace}`;
  if (ownerId) await auth.auth.admin.deleteUser(ownerId);
  await closeDb();
  rmSync(directory, { recursive: true, force: true });
  closeSync(log);
}
