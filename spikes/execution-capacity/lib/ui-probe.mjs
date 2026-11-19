import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { electronExe } from "./paths.mjs";
import { percentile } from "./stats.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui-probe-electron.mjs");

/**
 * @param {number} port
 * @param {Record<string, unknown>} message
 */
function askProbe(port, message) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("UI probe sample timed out"));
    }, 15000);
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      const line = buffer.slice(0, newline);
      socket.end();
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
    socket.write(`${JSON.stringify(message)}\n`);
  });
}

/**
 * @param {{ startupMs?: number }} [options]
 */
export async function startUiProbe(options = {}) {
  const exe = electronExe();
  if (!exe) {
    return {
      available: false,
      async measure() {
        return null;
      },
      async dispose() {},
    };
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, [script], {
    env,
    shell: false,
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Electron UI probe did not start: ${stderr.slice(0, 500)}`));
    }, options.startupMs ?? 20000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("{")) continue;
        try {
          const event = JSON.parse(line);
          if (event.event === "error") {
            clearTimeout(timer);
            reject(new Error(String(event.message)));
            return;
          }
          if (event.ready === true && event.port) {
            clearTimeout(timer);
            resolve(event);
          }
        } catch {
          // Ignore non-JSON Electron chatter.
        }
      }
    });
  });
  try {
    const started = await ready;
    const port = Number(started.port);
    return {
      available: true,
      pid: child.pid ?? null,
      /**
       * @param {number} samples
       */
      async measure(samples) {
        const event = await askProbe(port, { samples });
        const values = Array.isArray(event.samples) ? event.samples.map(Number).filter((value) => Number.isFinite(value)) : [];
        if (values.length === 0) return null;
        return {
          samples: values,
          p50Ms: percentile(values, 50),
          p95Ms: percentile(values, 95),
        };
      },
      async dispose() {
        try {
          await askProbe(port, { op: "exit" });
        } catch {
          // The window may already be closing.
        }
        if (child.exitCode === null) child.kill();
        await new Promise((resolve) => {
          if (child.exitCode !== null) {
            resolve(undefined);
            return;
          }
          child.once("close", () => resolve(undefined));
        });
      },
    };
  } catch (error) {
    if (child.exitCode === null) child.kill();
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      async measure() {
        return null;
      },
      async dispose() {},
    };
  }
}
