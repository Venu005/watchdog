/** @param {string} command @param {string} script */
export function ownsSupervisor(command, script) {
  return command.includes(script + " supervise");
}
/** @param {number[]} pids @param {(pid:number, signal:NodeJS.Signals)=>unknown} kill */
export function stopProcessGroups(pids, kill = process.kill) {
  for (const pid of pids) {
    try {
      kill(-pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
}
/** @param {number[]} pids @param {(pid:number, signal:NodeJS.Signals|0)=>unknown} kill @param {(ms:number)=>Promise<void>} pause @param {number} attempts */
export async function terminateProcessGroups(
  pids,
  kill = process.kill,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
  attempts = 32,
) {
  const alive = (pid) => {
    try {
      kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  stopProcessGroups(pids, kill);
  for (let i = 0; i < attempts && pids.some(alive); i++) await pause(250);
  for (const pid of pids.filter(alive)) {
    try {
      kill(-pid, "SIGKILL");
    } catch {}
  }
  for (let i = 0; i < 8 && pids.some(alive); i++) await pause(250);
  if (pids.some(alive))
    throw new Error("Owned process groups did not stop; inspect local logs.");
}
