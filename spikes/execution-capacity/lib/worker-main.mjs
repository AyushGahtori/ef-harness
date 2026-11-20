import readline from "node:readline";
import { spawn } from "node:child_process";
import { pnpmEntry, tscPath } from "./paths.mjs";
import { sleep } from "./spawn.mjs";

const offlineEnv = {
  ...process.env,
  npm_config_offline: "true",
  pnpm_config_offline: "true",
  npm_config_audit: "false",
  npm_config_fund: "false",
  NO_UPDATE_NOTIFIER: "1",
  ELECTRON_RUN_AS_NODE: "",
};

/** @type {Buffer[]} */
const ballast = [];

/**
 * @param {Record<string, unknown>} message
 */
function reply(message) {
  console.log(JSON.stringify({ ...message, rss: process.memoryUsage().rss }));
}

/**
 * @param {string} file
 * @param {readonly string[]} args
 * @param {string} cwd
 */
function runCommand(file, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd,
      env: offlineEnv,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stderr: stderr.slice(0, 500) });
    });
  });
}

/**
 * @param {string} cwd
 */
async function runActive(cwd) {
  /** @type {{ name: string, code: number }[]} */
  const commands = [];
  const pnpm = pnpmEntry();
  if (pnpm) {
    const testRun = await runCommand(process.execPath, [pnpm, "--offline", "test"], cwd);
    commands.push({ name: "pnpm --offline test", code: testRun.code });
  } else {
    const testRun = await runCommand(process.execPath, ["--test", "src/format.test.ts"], cwd);
    commands.push({ name: "node --test src/format.test.ts", code: testRun.code });
  }
  const typecheck = await runCommand(process.execPath, [tscPath(), "--noEmit", "-p", "tsconfig.json"], cwd);
  commands.push({ name: "tsc --noEmit", code: typecheck.code });
  return { ok: commands.every((command) => command.code === 0), commands };
}

const lines = readline.createInterface({ input: process.stdin });
reply({ ready: true, pid: process.pid });

for await (const line of lines) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (message.op === "exit") break;
  if (message.op === "idle") {
    const bytes = Number(message.holdBytes ?? 0);
    if (bytes > 0) ballast.push(Buffer.alloc(bytes, 1));
    await sleep(Number(message.ms ?? 40));
    reply({ op: "idle", ok: true });
  } else if (message.op === "active") {
    const result = await runActive(String(message.cwd));
    reply({ op: "active", ...result });
  } else if (message.op === "spawn-grandchild") {
    const grand = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    reply({ op: "spawn-grandchild", pid: grand.pid ?? null });
  } else {
    reply({ op: "error", message: "unknown op" });
  }
}

process.exit(0);
