import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectContainerRuntime } from "./container-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const containerName = "automation-watchdog-test-db";
const database = "watchdog_test";
const port = "55542";
const migration = resolve(
  root,
  "supabase/migrations/20261101000000_initial.sql",
);

function rawOutput(error) {
  return [error.stdout, error.stderr, error.message]
    .filter(Boolean)
    .map((value) => value.toString().trim())
    .filter(Boolean)
    .join("\n");
}

function run(command, args, options = {}) {
  const { input, ...executionOptions } = options;
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    ...executionOptions,
    input,
  });
}

function inspect(runtime, format) {
  try {
    return run(runtime.command, [
      "inspect",
      "--format",
      format,
      containerName,
    ]).trim();
  } catch {
    return null;
  }
}

async function waitForPostgres(runtime) {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      run(runtime.command, [
        "exec",
        containerName,
        "pg_isready",
        "-U",
        "postgres",
        "-d",
        database,
      ]);
      return;
    } catch (error) {
      lastError = rawOutput(error);
      await new Promise((resolveAfterDelay) =>
        setTimeout(resolveAfterDelay, 500),
      );
    }
  }
  throw new Error(
    `Timed out waiting for PostgreSQL in ${containerName}.\nRaw runtime output:\n${lastError}`,
  );
}

function applyMigrationIfNeeded(runtime) {
  const schemaExists = run(runtime.command, [
    "exec",
    containerName,
    "psql",
    "-U",
    "postgres",
    "-d",
    database,
    "-tAc",
    "select to_regclass('watchdog.workspaces') is not null",
  ]).trim();

  if (schemaExists === "t") {
    console.log("The isolated test database schema is already current.");
    return;
  }

  console.log("Applying the isolated test database schema.");
  run(
    runtime.command,
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      database,
    ],
    { input: readFileSync(migration) },
  );
}

async function main() {
  const runtime = await selectContainerRuntime();
  const running = inspect(runtime, "{{.State.Running}}");

  if (running === null) {
    console.log(`Creating isolated test database container ${containerName}.`);
    try {
      run(runtime.command, [
        "run",
        "-d",
        "--name",
        containerName,
        "-p",
        `127.0.0.1:${port}:5432`,
        "-e",
        "POSTGRES_PASSWORD=watchdog-local-test",
        "-e",
        `POSTGRES_DB=${database}`,
        "postgres:18-alpine",
      ]);
    } catch (error) {
      throw new Error(
        `Could not create ${containerName}.\nRaw runtime output:\n${rawOutput(error)}`,
      );
    }
  } else if (running !== "true") {
    console.log(`Starting isolated test database container ${containerName}.`);
    try {
      run(runtime.command, ["start", containerName]);
    } catch (error) {
      throw new Error(
        `Could not start ${containerName}.\nRaw runtime output:\n${rawOutput(error)}`,
      );
    }
  } else {
    console.log(
      `Isolated test database container ${containerName} is already running.`,
    );
  }

  await waitForPostgres(runtime);
  applyMigrationIfNeeded(runtime);
  console.log(
    `Isolated integration-test PostgreSQL is ready on 127.0.0.1:${port}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
