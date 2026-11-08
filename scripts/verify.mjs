import { spawnSync } from "node:child_process";

const mode = process.argv[2];
const scripts = {
  commit: ["format:check", "lint", "typecheck", "test"],
  push: [
    "format:check",
    "lint",
    "typecheck",
    "test",
    "build",
    "test:integration",
    "test:e2e",
  ],
};

if (!scripts[mode]) {
  console.error("Usage: node scripts/verify.mjs commit|push");
  process.exitCode = 1;
} else {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  for (const script of scripts[mode]) {
    console.log(`\n→ pnpm ${script}`);
    const result = spawnSync(command, [script], { stdio: "inherit" });
    if (result.error) {
      console.error(`Could not run pnpm ${script}: ${result.error.message}`);
      process.exitCode = 1;
      break;
    }
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
}
