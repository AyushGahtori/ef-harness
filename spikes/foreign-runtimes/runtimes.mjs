import path from "node:path";
import { fileURLToPath } from "node:url";
import { harnessMcpServer, runAcpProbe } from "./acp-probe.mjs";
import { runClaudeProbe } from "./claude-probe.mjs";
import { harnessMcpServer as codexMcpServer, runCodexProbe } from "./codex-probe.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const brief = { task: "T06", writeScope: ["src/**"] };

export function fakeScript(name) {
  return path.join(root, "fakes", name);
}

export function defaultPolicy(scratchRoot) {
  return {
    scratchRoot,
    writeScope: ["src/**"],
    commandAllowlist: ["node", "pnpm"],
  };
}

const ACP_FAKES = {
  acp: "acp-agent.mjs",
  copilot: "copilot-acp.mjs",
  gemini: "gemini-acp.mjs",
  opencode: "opencode-acp.mjs",
};

export async function runRuntime(runtime, options) {
  const policy = options.policy ?? defaultPolicy(options.cwd);
  const scenario = options.scenario ?? "conformance";
  if (runtime === "codex") {
    return runCodexProbe({
      command: options.command ?? process.execPath,
      args: options.args ?? [fakeScript("codex-app-server.mjs")],
      cwd: options.cwd,
      policy,
      scenario,
      mcpServers: options.mcp === false ? [] : [codexMcpServer(brief)],
      timeoutMs: options.timeoutMs,
      turn: options.turn,
      multiplex: options.multiplex,
      job: options.job,
    });
  }
  if (runtime === "claude") {
    return runClaudeProbe({
      command: options.command ?? process.execPath,
      args: [...(options.args ?? [fakeScript("claude-stream-json.mjs")]), ...(options.extraArgs ?? [])],
      cwd: options.cwd,
      policy,
      scenario,
      apiKey: options.apiKey,
      env: options.env,
      mcpCommand: options.mcp === false ? undefined : process.execPath,
      mcpArgs: [path.join(root, "mini-mcp.mjs")],
      timeoutMs: options.timeoutMs,
      job: options.job,
    });
  }
  const script = ACP_FAKES[runtime];
  if (!script) return { ok: false, code: "unknown_runtime", runtime };
  return runAcpProbe({
    runtime,
    command: options.command ?? process.execPath,
    args: [...(options.args ?? [fakeScript(script)]), ...(options.extraArgs ?? [])],
    cwd: options.cwd,
    policy,
    scenario,
    mcpServers: options.mcp === false ? [] : [harnessMcpServer(brief)],
    timeoutMs: options.timeoutMs,
    prompt: options.prompt,
    job: options.job,
  });
}
