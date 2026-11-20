import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { directSpawn } from "./spawn-direct.mjs";

const helperScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "helpers", "win32-helper.ps1");

export function systemRoot() {
  return process.env.SystemRoot || "C:\\Windows";
}

export function systemExe(name) {
  return path.join(systemRoot(), "System32", name);
}

export function powershellPath() {
  return path.join(systemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * One long-lived Windows PowerShell helper. Requests are serialized.
 */
export function startWin32Helper() {
  const child = directSpawn(powershellPath(), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helperScript,
  ], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!child.stdin || !child.stdout) {
    throw new Error("Win32 helper stdio was not piped");
  }
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("close", () => {
    closed = true;
  });
  /** @type {Array<(line: string) => void>} */
  const waiters = [];
  lines.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
  });
  let closed = false;
  /** @type {Promise<void>} */
  let chain = Promise.resolve();

  function roundTrip(payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error(`Win32 helper is closed\n${stderr}`));
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error(`Win32 helper timed out after ${timeoutMs}ms\n${stderr}`));
      }, timeoutMs);
      waiters.push((line) => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(line));
        } catch (error) {
          reject(new Error(`Win32 helper returned non-JSON: ${line}\n${error instanceof Error ? error.message : ""}`));
        }
      });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  return {
    pid: child.pid,
    script: helperScript,
    stderr() {
      return stderr;
    },
    request(payload, timeoutMs = 20000) {
      const run = chain.then(() => roundTrip(payload, timeoutMs));
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
    async close() {
      if (!closed) {
        closed = true;
        try {
          child.stdin.write(`${JSON.stringify({ op: "exit", id: "exit" })}\n`);
          child.stdin.end();
        } catch (error) {
          stderr += error instanceof Error ? error.message : String(error);
        }
      }
      if (child.exitCode === null && child.pid) {
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            if (child.exitCode === null && child.pid) child.kill();
            resolve(undefined);
          }, 2000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve(undefined);
          });
        });
      }
      lines.close();
    },
    kill() {
      closed = true;
      if (child.exitCode === null && child.pid) child.kill();
    },
  };
}
