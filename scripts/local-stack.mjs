import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  openSync,
  closeSync,
  writeSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createServer } from "node:net";
import {
  ownsSupervisor,
  terminateProcessGroups,
} from "./local-stack-helpers.mjs";
import {
  probeContainerRuntimes,
  selectContainerRuntime,
} from "./container-runtime.mjs";
const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), "..");
process.chdir(root);
const stateDir = resolve(root, ".local-stack");
const stateFile = resolve(stateDir, "supervisor.json");
const runtimeFile = resolve(stateDir, "container-runtime.json");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
function run(command, args, quiet = false, environment) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    env: environment ? { ...process.env, ...environment } : process.env,
  });
}
function succeeds(command, args) {
  try {
    run(command, args, true);
    return true;
  } catch {
    return false;
  }
}
function state() {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}
function savedRuntime() {
  try {
    const runtime = JSON.parse(readFileSync(runtimeFile, "utf8"));
    return runtime?.id === "docker" || runtime?.id === "podman"
      ? runtime
      : null;
  } catch {
    return null;
  }
}
function saveRuntime(runtime) {
  writeFileSync(
    runtimeFile,
    JSON.stringify({ id: runtime.id, command: runtime.command }),
    { mode: 0o600 },
  );
}
function owned(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    return ownsSupervisor(
      run("ps", ["-p", String(pid), "-o", "args="], true),
      script,
    );
  } catch {
    return false;
  }
}
function save(status, message) {
  writeFileSync(
    stateFile,
    JSON.stringify({ pid: process.pid, status, message }),
    { mode: 0o600 },
  );
}
async function freePort(port) {
  await new Promise((ok, fail) => {
    const server = createServer();
    server.once("error", () =>
      fail(
        new Error(
          `Port ${port} is already occupied. Stop the existing server before local:start.`,
        ),
      ),
    );
    server.listen(port, "0.0.0.0", () => server.close(ok));
  });
}
async function healthy() {
  try {
    const [web, n8n] = await Promise.all([
      fetch("http://127.0.0.1:3100/api/health", {
        signal: AbortSignal.timeout(3000),
      }),
      fetch("http://127.0.0.1:5678/healthz", {
        signal: AbortSignal.timeout(3000),
      }),
    ]);
    const body = await web.json();
    return web.ok && body.ready === true && n8n.ok;
  } catch {
    return false;
  }
}
async function start() {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lock = resolve(stateDir, "starting");
  try {
    mkdirSync(lock);
    writeFileSync(resolve(lock, "owner"), String(process.pid));
  } catch {
    throw new Error(
      "Another local:start is in progress. If it was interrupted, remove .local-stack/starting and retry.",
    );
  }
  try {
    const old = state();
    if (old && owned(old.pid)) {
      if (old.status === "ready") {
        if (!(await healthy()))
          throw new Error(
            "Local services are no longer healthy. Run pnpm local:stop, then pnpm local:start.",
          );
        printLinks();
        return;
      }
      throw new Error(
        "The local supervisor is already starting. Check .local-stack/supervisor.log.",
      );
    }
    if (!existsSync(".env.local"))
      throw new Error(
        "Missing .env.local. Complete the first-time README setup before local:start.",
      );
    await freePort(3100);
    const runtime = await selectContainerRuntime();
    saveRuntime(runtime);
    console.log("Starting local Supabase (the first run may download images)…");
    try {
      run("pnpm", ["stack:start"], true, {
        WATCHDOG_CONTAINER_RUNTIME: runtime.id,
      });
    } catch {
      throw new Error(
        "Supabase startup failed. Run pnpm stack:start to inspect the local CLI output, then pnpm local:stop.",
      );
    }
    if (succeeds(runtime.command, ["container", "inspect", "watchdog-n8n"])) {
      run(runtime.command, ["start", "watchdog-n8n"]);
    } else {
      run(runtime.command, ["volume", "create", "watchdog_n8n_data"]);
      run(runtime.command, [
        "run",
        "-d",
        "--name",
        "watchdog-n8n",
        "--restart",
        "unless-stopped",
        "-p",
        "127.0.0.1:5678:5678",
        "-e",
        "TZ=UTC",
        "-e",
        "GENERIC_TIMEZONE=UTC",
        "-e",
        "N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true",
        "-e",
        "N8N_DIAGNOSTICS_ENABLED=false",
        "-v",
        "watchdog_n8n_data:/home/node/.n8n",
        "docker.n8n.io/n8nio/n8n:2.45.7",
      ]);
    }
    const containerId = run(
      runtime.command,
      ["inspect", "--format", "{{.Id}}", "watchdog-n8n"],
      true,
    ).trim();
    writeFileSync(resolve(stateDir, "n8n-id"), containerId, { mode: 0o600 });
    const log = openSync(resolve(stateDir, "supervisor.log"), "a", 0o600);
    const supervisor = spawn(process.execPath, [script, "supervise"], {
      cwd: root,
      detached: true,
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await new Promise((ok, fail) => {
      supervisor.once("spawn", ok);
      supervisor.once("error", fail);
    });
    supervisor.unref();
    const end = Date.now() + 120000;
    while (Date.now() < end) {
      const current = state();
      if (current?.pid === supervisor.pid) {
        if (current.status === "ready") {
          printLinks();
          return;
        }
        if (current.status === "failed") throw new Error(current.message);
      }
      if (!owned(supervisor.pid))
        throw new Error(
          "Local supervisor exited. Check .local-stack/supervisor.log.",
        );
      await sleep(500);
    }
    if (owned(supervisor.pid)) process.kill(supervisor.pid, "SIGTERM");
    throw new Error(
      "Startup timed out. Check .local-stack logs. Run pnpm local:stop to stop container services.",
    );
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
function printLinks() {
  console.log(
    "\nWatchdog: http://127.0.0.1:3100\nn8n:      http://localhost:5678\nMailpit:  http://127.0.0.1:54324\nHealth:   http://127.0.0.1:3100/api/health\n\nWeb and worker run in the background. Logs: .local-stack/\nStop with: pnpm local:stop\nDevelopment server listens on 0.0.0.0 for Docker access; use a trusted network.",
  );
}
async function supervise() {
  const children = [];
  let stopping = false;
  let workerReady = false;
  save("starting");
  async function cleanup(status, message) {
    if (stopping) return;
    stopping = true;
    try {
      await terminateProcessGroups(
        children.map((child) => child.pid).filter(Boolean),
      );
      save(status, message);
    } catch (error) {
      save("failed", error.message);
    }
    process.exit(status === "failed" ? 1 : 0);
  }
  process.on("SIGTERM", () => cleanup("stopped"));
  process.on("SIGINT", () => cleanup("stopped"));
  function launch(args, name) {
    const log = openSync(resolve(stateDir, name + ".log"), "a", 0o600);
    const child = spawn(process.execPath, args, {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => {
        output = (output + data.toString()).slice(-1000);
        if (
          name === "worker" &&
          (output.includes('"event":"worker.ready"') ||
            output.includes("Watchdog worker ready"))
        )
          workerReady = true;
        // Write only to local ignored files; never echo environment variables.
        try {
          writeSync(log, data);
        } catch {}
      });
    child.once("error", (error) =>
      cleanup("failed", `${name} failed to start: ${error.message}`),
    );
    child.once("exit", (code) => {
      closeSync(log);
      if (!stopping)
        cleanup(
          "failed",
          `${name} exited (${code}); inspect .local-stack/${name}.log`,
        );
    });
  }
  launch(
    [
      resolve(root, "node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "0.0.0.0",
      "--port",
      "3100",
    ],
    "web",
  );
  launch(
    ["--env-file=.env.local", "--import", "tsx", "src/worker/index.ts"],
    "worker",
  );
  const end = Date.now() + 100000;
  while (!stopping && Date.now() < end) {
    try {
      const [health, n8n] = await Promise.all([
        fetch("http://127.0.0.1:3100/api/health", {
          signal: AbortSignal.timeout(3000),
        }),
        fetch("http://127.0.0.1:5678/healthz", {
          signal: AbortSignal.timeout(3000),
        }),
      ]);
      const body = await health.json();
      if (workerReady && health.ok && body.ready && n8n.ok) {
        save("ready");
        return;
      }
    } catch {
      /* Services are still starting. */
    }
    await sleep(500);
  }
  if (!stopping)
    cleanup(
      "failed",
      "Services did not become healthy. Inspect .local-stack/web.log and worker.log.",
    );
}
async function stop() {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lock = resolve(stateDir, "starting");
  const end = Date.now() + 600000;
  while (true) {
    try {
      mkdirSync(lock);
      writeFileSync(resolve(lock, "owner"), String(process.pid));
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = Number(readFileSync(resolve(lock, "owner"), "utf8"));
        if (Number.isSafeInteger(owner) && owner > 1) {
          try {
            process.kill(owner, 0);
          } catch (error) {
            if (error.code === "ESRCH") {
              rmSync(lock, { recursive: true, force: true });
              continue;
            }
          }
        }
      } catch {
        /* A command may still be writing its lock ownership. */
      }
      if (Date.now() > end)
        throw new Error(
          "Another lifecycle command is still running. Check .local-stack/starting.",
        );
      await sleep(250);
    }
  }
  try {
    await stopLocked();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
async function stopLocked() {
  const current = state();
  if (current && owned(current.pid)) {
    process.kill(current.pid, "SIGTERM");
    for (let i = 0; i < 60 && owned(current.pid); i++) await sleep(250);
    if (owned(current.pid))
      throw new Error(
        "Supervisor is still shutting down. Retry local:stop shortly.",
      );
  }
  const stored = savedRuntime();
  const available = stored
    ? [stored]
    : probeContainerRuntimes().filter((runtime) => runtime.available);
  const recorded = existsSync(resolve(stateDir, "n8n-id"))
    ? readFileSync(resolve(stateDir, "n8n-id"), "utf8").trim()
    : "";
  const runtime = available.find(
    (candidate) =>
      succeeds(candidate.command, ["info"]) &&
      (!recorded ||
        succeeds(candidate.command, ["container", "inspect", "watchdog-n8n"])),
  );
  if (runtime) {
    for (const container of ["watchdog-n8n"]) {
      if (
        recorded &&
        succeeds(runtime.command, ["container", "inspect", container])
      ) {
        const actual = run(
          runtime.command,
          ["inspect", "--format", "{{.Id}}", container],
          true,
        ).trim();
        if (actual === recorded) run(runtime.command, ["stop", container]);
        else console.log("n8n container identity changed; left it running.");
      }
    }
    try {
      run("pnpm", ["stack:stop"], true, {
        WATCHDOG_CONTAINER_RUNTIME: runtime.id,
      });
    } catch {
      throw new Error(
        "Supabase stop failed. Inspect pnpm stack:stop before shutting down the container engine.",
      );
    }
    const remaining = run(runtime.command, ["ps", "-q"], true).trim();
    if (remaining)
      console.log(
        "Other containers are running; the container engine was left on.",
      );
  } else {
    console.log(
      "No running container engine was found; n8n and Supabase were left untouched.",
    );
  }
  console.log(
    "Watchdog local services stopped. Data and credentials preserved.",
  );
}
try {
  const mode = process.argv[2];
  if (mode === "start") await start();
  else if (mode === "stop") await stop();
  else if (mode === "supervise") await supervise();
  else throw new Error("Usage: pnpm local:start | pnpm local:stop");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
