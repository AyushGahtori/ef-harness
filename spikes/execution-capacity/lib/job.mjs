import { spawn } from "node:child_process";
import { holdJob } from "./win32.mjs";
import { pidAlive } from "./spawn.mjs";

/**
 * @param {{ args: readonly string[], cwd?: string, env?: NodeJS.ProcessEnv, memoryLimitBytes?: number }} options
 */
export async function startJobProcess(options) {
  const child = spawn(process.execPath, options.args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!child.pid) {
    throw new Error("spawn did not return a pid");
  }
  const holder = holdJob(child.pid, options.memoryLimitBytes ?? 0);
  let stdout = "";
  let stderr = "";
  let pending = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      if (line) options.onLine?.(line);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const ready = await holder.ready;
  return {
    pid: child.pid,
    holderPid: holder.pid,
    flags: ready.flags ?? null,
    stdin: child.stdin,
    output() {
      return { stdout, stderr, holder: holder.output() };
    },
    async dispose() {
      try {
        child.stdin.end();
      } catch {
        // The worker may already have closed stdin.
      }
      await holder.dispose();
    },
    alive() {
      return pidAlive(child.pid);
    },
  };
}
