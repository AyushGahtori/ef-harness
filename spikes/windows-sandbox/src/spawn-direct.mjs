import { spawn, spawnSync } from "node:child_process";

/**
 * Quote one argv element for CreateProcess command lines.
 * Node's spawn uses an argv array and does not need this; CreateProcessAsUserW does.
 * @param {string} arg
 */
export function quoteWindowsArg(arg) {
  const value = String(arg);
  if (value.length === 0) return '""';
  if (!/[\t\n\v\f "]/.test(value)) return value;
  let quoted = '"';
  let slashes = 0;
  for (const ch of value) {
    if (ch === "\\") {
      slashes += 1;
      continue;
    }
    if (ch === '"') {
      quoted += "\\".repeat(slashes * 2 + 1);
      quoted += '"';
      slashes = 0;
      continue;
    }
    if (slashes > 0) {
      quoted += "\\".repeat(slashes);
      slashes = 0;
    }
    quoted += ch;
  }
  if (slashes > 0) quoted += "\\".repeat(slashes * 2);
  quoted += '"';
  return quoted;
}

/**
 * @param {readonly string[]} argv
 */
export function quoteWindowsCommandLine(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new TypeError("argv must be a non-empty array");
  }
  return argv.map((arg) => quoteWindowsArg(arg)).join(" ");
}

/**
 * Every launcher child is created with an argv array and shell disabled.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import('node:child_process').SpawnOptions} [options]
 */
export function directSpawn(command, args, options = {}) {
  if (typeof command !== "string" || command.length === 0) {
    throw new TypeError("command must be a non-empty string");
  }
  if (!Array.isArray(args)) throw new TypeError("args must be an array");
  if (options.shell) {
    throw new Error("shell spawn is forbidden in the sandbox launcher");
  }
  return spawn(command, args, {
    ...options,
    shell: false,
    windowsHide: options.windowsHide !== false,
  });
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [options]
 */
export function directSpawnSync(command, args, options = {}) {
  if (typeof command !== "string" || command.length === 0) {
    throw new TypeError("command must be a non-empty string");
  }
  if (!Array.isArray(args)) throw new TypeError("args must be an array");
  if (options.shell) {
    throw new Error("shell spawn is forbidden in the sandbox launcher");
  }
  return spawnSync(command, args, {
    ...options,
    shell: false,
    windowsHide: options.windowsHide !== false,
  });
}
