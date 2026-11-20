import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeInstalled } from "./live-probe.mjs";
import { buildReport, renderReport } from "./report.mjs";
import { runRuntime } from "./runtimes.mjs";
import { withScratchWorktree } from "./scratch.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const RUNTIMES = ["acp", "codex", "copilot", "claude", "gemini", "opencode"];

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function syntheticConsoleKey() {
  return ["sk", "-ant", "-api", "03-spike"].join("");
}

async function once(runtime) {
  const scenario = argValue("--scenario") ?? "conformance";
  const timeout = Number(argValue("--timeout") ?? (scenario === "hang" ? 1200 : 20000));
  const command = argValue("--command");
  const scriptArgs = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--arg") scriptArgs.push(process.argv[index + 1] ?? "");
  }
  const extraArgs = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--extra-arg") extraArgs.push(process.argv[index + 1] ?? "");
  }
  const wrapped = await withScratchWorktree(async (cwd) => runRuntime(runtime, {
    cwd,
    scenario,
    timeoutMs: timeout,
    apiKey: process.env.EF_SPIKE_CLAUDE_KEY,
    env: process.env,
    command,
    args: scriptArgs.length > 0 ? scriptArgs : undefined,
    extraArgs,
    mcp: !process.argv.includes("--no-mcp"),
    turn: !process.argv.includes("--no-turn"),
  }));
  return {
    ...wrapped.value,
    scratch: wrapped.dir,
    scratchExists: fs.existsSync(wrapped.dir),
  };
}

async function writeFindings(live) {
  const fake = {};
  for (const runtime of RUNTIMES) {
    if (runtime === "claude") process.env.EF_SPIKE_CLAUDE_KEY = syntheticConsoleKey();
    const wrapped = await withScratchWorktree((cwd) => runRuntime(runtime, {
      cwd,
      scenario: "conformance",
      timeoutMs: 40000,
      apiKey: process.env.EF_SPIKE_CLAUDE_KEY,
      env: process.env,
    }));
    fake[runtime] = wrapped.value;
  }
  delete process.env.EF_SPIKE_CLAUDE_KEY;
  const report = buildReport({ fake, live });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await fs.promises.writeFile(path.join(root, "report.json"), json);
  await fs.promises.writeFile(path.join(root, "REPORT.md"), renderReport(report));
  return report;
}

const runtime = argValue("--runtime");
try {
  if (process.argv.includes("--once")) {
    if (!runtime) throw new Error("missing --runtime");
    const result = await once(runtime);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(result.ok === true ? 0 : 1);
  }
  if (process.argv.includes("--report")) {
    let live = {
      acp: { status: "fake_only", version: null },
      codex: { status: "not_run", version: null },
      copilot: { status: "not_run", version: null },
      claude: { status: "not_run", version: null },
      gemini: { status: "not_run", version: null },
      opencode: { status: "not_run", version: null },
    };
    if (process.argv.includes("--live")) {
      const scratch = await withScratchWorktree(async (cwd) => probeInstalled(cwd));
      live = scratch.value;
    }
    const report = await writeFindings(live);
    process.stdout.write(`${JSON.stringify({ ok: true, verdict: report.codexMultiplexing.schedulingVerdict })}\n`);
    process.exit(0);
  }
  process.stderr.write("usage: probe.mjs --once --runtime <name> | --report [--live]\n");
  process.exit(2);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    code: "probe_failed",
    message: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exit(1);
}
