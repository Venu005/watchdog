import { spawnSync } from "node:child_process";
import {
  environmentForContainerRuntime,
  selectContainerRuntime,
} from "./container-runtime.mjs";

const action = process.argv[2];
if (action !== "start" && action !== "stop") {
  console.error("Usage: node scripts/supabase-stack.mjs start|stop");
  process.exitCode = 1;
} else {
  let environment;
  try {
    const runtime = await selectContainerRuntime();
    environment = environmentForContainerRuntime(runtime);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  if (!process.exitCode) {
    const args = ["exec", "supabase", action];
    const result = spawnSync("pnpm", args, {
      stdio: "inherit",
      env: { ...process.env, ...environment },
    });
    if (result.error) {
      console.error(`Unable to run Supabase: ${result.error.message}`);
      process.exitCode = 1;
    } else process.exitCode = result.status ?? 1;
  }
}
