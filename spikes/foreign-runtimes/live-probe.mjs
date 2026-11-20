import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planSpawn, spawnRuntime, interruptRuntime } from "./spawn-runtime.mjs";
import { redact } from "./report.mjs";
import { runCodexProbe } from "./codex-probe.mjs";

const versionScript = fileURLToPath(new URL("./file-version.ps1", import.meta.url));

function packageVersion(plan) {
  const starts = [...(plan.args ?? []), plan.file].filter((item) => typeof item === "string" && item.toLowerCase().endsWith(".js"));
  for (const start of starts) {
    let dir = path.dirname(start);
    for (let depth = 0; depth < 5; depth += 1) {
      const manifest = path.join(dir, "package.json");
      if (fs.existsSync(manifest)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
          if (typeof parsed.version === "string" && /^[0-9]+\.[0-9]+\.[0-9]+/.test(parsed.version)) {
            return parsed.version;
          }
        } catch {
          /* unreadable manifest */
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function fileVersion(file) {
  if (process.platform !== "win32" || path.extname(file).toLowerCase() !== ".exe") return Promise.resolve(null);
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise((resolve) => {
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-File", versionScript, "-Path", file], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 4000);
    child.once("exit", () => {
      clearTimeout(timer);
      const version = stdout.trim().split(/\r?\n/).find(Boolean) ?? "";
      resolve(/^[0-9]+\.[0-9]+\.[0-9]+/.test(version) ? version : null);
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function captureVersion(command, args) {
  const plan = planSpawn(command, args);
  if (plan.status !== "ok") return { status: "not_installed", version: null };
  const handle = await spawnRuntime({
    command,
    args,
    job: true,
    env: undefined,
  });
  if (handle.status !== "ok") return { status: "not_installed", version: null };
  let stdout = "";
  let stderr = "";
  handle.child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  handle.child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  handle.child.stdin.end();
  const finished = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    handle.child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  await interruptRuntime(handle, 200);
  const printed = redact(`${stdout}\n${stderr}`);
  if (finished && printed) return { status: "ok", version: printed, versionSource: "stdout" };
  const fromPackage = packageVersion(plan);
  if (fromPackage) return { status: "ok", version: fromPackage, versionSource: finished ? "package" : "package-after-hung-command" };
  const fromFile = await fileVersion(plan.file);
  if (fromFile) return { status: "ok", version: fromFile, versionSource: "file-version" };
  return { status: finished ? "empty" : "timeout", version: null };
}

export async function probeInstalled(cwd) {
  const live = {
    acp: { status: "fake_only", version: null },
    codex: await captureVersion("codex", ["--version"]),
    copilot: await captureVersion("copilot", ["--version"]),
    claude: { status: "not_installed", version: null, apiKey: "not_sent" },
    gemini: await captureVersion("gemini", ["--version"]),
    opencode: await captureVersion("opencode", ["--version"]),
  };
  const claudePlan = planSpawn("claude", ["--version"]);
  if (claudePlan.status === "ok") {
    live.claude = { status: "refused", version: null, apiKey: "missing_console_api_key" };
  }
  if (planSpawn("codex", ["app-server"]).status === "ok") {
    const probed = await runCodexProbe({
      command: "codex",
      args: ["app-server"],
      cwd,
      policy: { scratchRoot: cwd, writeScope: ["src/**"], commandAllowlist: ["node"] },
      scenario: "conformance",
      mcpServers: [],
      turn: false,
      multiplex: true,
      timeoutMs: 15000,
    });
    live.codex = {
      ...live.codex,
      handshake: probed.ok === true ? "initialized" : probed.code ?? "failed",
      multiplexes: probed.multiplexes === true,
      ignored: Array.isArray(probed.ignored) ? [...new Set(probed.ignored)] : [],
      status: probed.ok === true ? "ok" : live.codex.status,
    };
  }
  return live;
}
