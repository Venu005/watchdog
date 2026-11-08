import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const supported = [
  {
    id: "docker",
    command: "docker",
    args: ["info"],
    label: "Docker-compatible engine",
    supabaseRuntime: "docker",
  },
  {
    id: "podman",
    command: "podman",
    args: ["info"],
    label: "Podman",
    supabaseRuntime: "podman",
  },
];

function outputOf(error) {
  const output = [error.stdout, error.stderr]
    .filter(Boolean)
    .map((value) => value.toString().trim())
    .filter(Boolean)
    .join("\n");
  return output || error.message || String(error);
}

function execute(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function deviceDescription(
  platform = process.platform,
  arch = process.arch,
  glibc = process.report?.getReport?.().header?.glibcVersionRuntime,
) {
  const names = { darwin: "macOS", linux: "Linux", win32: "Windows" };
  const description = `${names[platform] ?? platform} (${arch})`;
  return glibc ? `${description}, glibc ${glibc}` : description;
}

export function probeContainerRuntimes(run = execute) {
  return supported.map((runtime) => {
    try {
      run(runtime.command, runtime.args);
      return { ...runtime, available: true, error: "" };
    } catch (error) {
      return { ...runtime, available: false, error: outputOf(error) };
    }
  });
}

export function environmentForContainerRuntime(runtime, run = execute) {
  if (runtime.id !== "podman") return {};
  try {
    const socket = run("podman", [
      "info",
      "--format",
      "{{.Host.RemoteSocket.Path}}",
    ])
      .toString()
      .trim();
    if (!socket)
      throw new Error("Podman did not report a Docker-compatible socket path.");
    return {
      DOCKER_HOST: socket.startsWith("unix://") ? socket : `unix://${socket}`,
    };
  } catch (error) {
    throw new Error(
      "Podman is available, but Supabase could not find its Docker-compatible socket.\n" +
        `Raw Podman output:\n${outputOf(error)}`,
    );
  }
}

export function unavailableRuntimeMessage(device, probes) {
  const failures = probes
    .map(
      (runtime) =>
        `--- ${runtime.label} (${runtime.command} ${runtime.args.join(" ")}) ---\n${runtime.error}`,
    )
    .join("\n\n");
  return [
    `No usable OCI container runtime was found on ${device}.`,
    "Watchdog's local stack needs a running Docker-compatible engine because n8n runs in a container.",
    "Install and start Docker Desktop, OrbStack, Rancher Desktop, or Podman, then retry.",
    "\nRaw probe output:",
    failures,
  ].join("\n");
}

export function runtimeFromPreference(probes, preference) {
  const available = probes.filter((runtime) => runtime.available);
  if (!preference) return null;
  const selected = available.find((runtime) => runtime.id === preference);
  if (selected) return selected;
  const found = available.map((runtime) => runtime.id).join(", ") || "none";
  throw new Error(
    `WATCHDOG_CONTAINER_RUNTIME=${preference} is unavailable. Available runtimes: ${found}.`,
  );
}

export async function selectContainerRuntime({
  probes = probeContainerRuntimes(),
  device = deviceDescription(),
  preference = process.env.WATCHDOG_CONTAINER_RUNTIME,
  interactive = stdin.isTTY && stdout.isTTY,
  ask,
} = {}) {
  const preferred = runtimeFromPreference(probes, preference);
  if (preferred) return preferred;
  const available = probes.filter((runtime) => runtime.available);
  if (!available.length)
    throw new Error(unavailableRuntimeMessage(device, probes));
  if (available.length === 1) {
    console.log(`Using ${available[0].label} on ${device}.`);
    return available[0];
  }
  if (!interactive)
    throw new Error(
      `Multiple OCI container runtimes are available (${available.map((runtime) => runtime.id).join(", ")}). ` +
        "Set WATCHDOG_CONTAINER_RUNTIME to docker or podman.",
    );
  const question =
    `Multiple OCI container runtimes are available on ${device}:\n` +
    available
      .map(
        (runtime, index) => `  ${index + 1}) ${runtime.label} (${runtime.id})`,
      )
      .join("\n") +
    "\nChoose a runtime: ";
  if (ask) return chooseFromAnswer(await ask(question), available);
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return chooseFromAnswer(await prompt.question(question), available);
  } finally {
    prompt.close();
  }
}

export function chooseFromAnswer(answer, available) {
  const value = answer.trim().toLowerCase();
  const index = Number(value);
  const selected =
    available.find((runtime) => runtime.id === value) ||
    (Number.isInteger(index) ? available[index - 1] : undefined);
  if (selected) return selected;
  throw new Error(
    `Invalid runtime selection "${answer}". Run again and choose one of: ${available.map((runtime) => runtime.id).join(", ")}.`,
  );
}
