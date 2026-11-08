import { describe, it, expect, vi } from "vitest";
import {
  ownsSupervisor,
  stopProcessGroups,
} from "../../scripts/local-stack-helpers.mjs";
import {
  chooseFromAnswer,
  deviceDescription,
  environmentForContainerRuntime,
  probeContainerRuntimes,
  selectContainerRuntime,
  unavailableRuntimeMessage,
} from "../../scripts/container-runtime.mjs";
describe("local stack process safety", () => {
  it("refuses a stale PID reused by an unrelated server", () => {
    expect(
      ownsSupervisor(
        "node other-project/server.js",
        "/repo/scripts/local-stack.mjs",
      ),
    ).toBe(false);
    expect(
      ownsSupervisor(
        "node /repo/scripts/local-stack.mjs start",
        "/repo/scripts/local-stack.mjs",
      ),
    ).toBe(false);
    expect(
      ownsSupervisor(
        "node /other/scripts/local-stack.mjs supervise",
        "/repo/scripts/local-stack.mjs",
      ),
    ).toBe(false);
    expect(
      ownsSupervisor(
        "node /repo/scripts/local-stack.mjs supervise",
        "/repo/scripts/local-stack.mjs",
      ),
    ).toBe(true);
  });
  it("cleans up every owned child even when an earlier child has already exited", () => {
    const kill = vi.fn((pid: number) => {
      if (pid === -10) throw new Error("gone");
    });
    stopProcessGroups([10, 20], kill);
    expect(kill).toHaveBeenCalledWith(-10, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-20, "SIGTERM");
  });
});
it("force-stops an owned process group that ignores graceful shutdown", async () => {
  const { terminateProcessGroups } =
    await import("../../scripts/local-stack-helpers.mjs");
  let alive = true;
  const kill = vi.fn((_pid: number, signal: NodeJS.Signals | 0) => {
    if (signal === 0 && !alive) throw new Error("gone");
    if (signal === "SIGKILL") alive = false;
  });
  await terminateProcessGroups([42], kill, async () => {}, 2);
  expect(kill).toHaveBeenCalledWith(-42, "SIGTERM");
  expect(kill).toHaveBeenCalledWith(-42, "SIGKILL");
  expect(alive).toBe(false);
});

it("reports the host and preserves raw OCI runtime probe errors", () => {
  const probes = probeContainerRuntimes(() => {
    throw Object.assign(new Error("command failed"), {
      stderr: Buffer.from("daemon socket is unavailable"),
    });
  });
  const message = unavailableRuntimeMessage(
    deviceDescription("linux", "x64", "2.39"),
    probes,
  );
  expect(message).toContain("Linux (x64), glibc 2.39");
  expect(message).toContain("daemon socket is unavailable");
  expect(message).toContain(
    "Docker Desktop, OrbStack, Rancher Desktop, or Podman",
  );
});

it("uses the only healthy runtime without prompting", async () => {
  const selected = await selectContainerRuntime({
    device: "Linux (x64)",
    probes: [
      {
        id: "docker",
        command: "docker",
        args: ["info"],
        label: "Docker-compatible engine",
        available: false,
        error: "down",
        supabaseRuntime: "docker",
      },
      {
        id: "podman",
        command: "podman",
        args: ["info"],
        label: "Podman",
        available: true,
        error: "",
        supabaseRuntime: "podman",
      },
    ],
    interactive: false,
  });
  expect(selected.id).toBe("podman");
});

it("accepts a numbered or named choice when several runtimes are healthy", () => {
  const runtimes = [
    { id: "docker", label: "Docker-compatible engine" },
    { id: "podman", label: "Podman" },
  ];
  expect(chooseFromAnswer("2", runtimes).id).toBe("podman");
  expect(chooseFromAnswer("docker", runtimes).id).toBe("docker");
});

it("routes Supabase to Podman's Docker-compatible socket", () => {
  const environment = environmentForContainerRuntime(
    { id: "podman" },
    (command, args) => {
      expect(command).toBe("podman");
      expect(args).toEqual(["info", "--format", "{{.Host.RemoteSocket.Path}}"]);
      return "/run/user/1000/podman/podman.sock\n";
    },
  );
  expect(environment).toEqual({
    DOCKER_HOST: "unix:///run/user/1000/podman/podman.sock",
  });
});
