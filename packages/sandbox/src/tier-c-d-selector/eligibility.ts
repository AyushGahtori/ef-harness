import type { RuntimeDispatch, TaskSandboxSpec, TierCBlockReason, TierCEligibility } from "./types.js";

const INSTALL_COMMAND =
  /\b(?:pnpm\s+(?:install|i|add|update|up)|npm\s+(?:install|i|ci|add)|yarn\s+(?:install|add)|bun\s+(?:install|add))\b/i;
const DEV_SERVER_COMMAND =
  /\b(?:pnpm\s+(?:dev|start|run\s+(?:dev|start))|npm\s+(?:start|run\s+(?:dev|start))|yarn\s+(?:dev|start)|next\s+dev|vite(?:\s+dev)?|webpack\s+serve|nodemon|nest\s+start)\b/i;
const UNTRUSTED_RUNNER = /\b(?:npx|bunx|pnpm\s+dlx|npm\s+exec)\b/i;

function commandLine(command: string | readonly string[]): string {
  return typeof command === "string" ? command : command.join(" ");
}

function commandLines(commands: readonly (string | readonly string[])[]): string[] {
  return commands.map((command) => commandLine(command));
}

function pushBlock(blocks: TierCBlockReason[], reason: TierCBlockReason): void {
  if (!blocks.includes(reason)) blocks.push(reason);
}

export function isTaskEligibleForTierC(
  taskSpec: TaskSandboxSpec,
  runtime: RuntimeDispatch,
): TierCEligibility {
  const blocks: TierCBlockReason[] = [];
  const lines = commandLines(taskSpec.commands);
  if (taskSpec.dependencyInstall === true || lines.some((line) => INSTALL_COMMAND.test(line))) {
    pushBlock(blocks, "dependency_install");
  }
  if (taskSpec.needsExternalNetwork === true) pushBlock(blocks, "external_network");
  if (taskSpec.runsUntrustedDevServer === true || lines.some((line) => DEV_SERVER_COMMAND.test(line))) {
    pushBlock(blocks, "untrusted_dev_server");
  }
  if (taskSpec.touchesUntrustedPackages === true || lines.some((line) => UNTRUSTED_RUNNER.test(line))) {
    pushBlock(blocks, "untrusted_packages");
  }
  if (taskSpec.runsThirdPartyCodeBeyondLockedDeps === true) pushBlock(blocks, "third_party_code");

  const eligible = blocks.length === 0;
  const wrappedForbidden = runtime.kind === "foreign_agent" && runtime.requestedMode === "wrapped";
  const forcedMode = runtime.kind === "foreign_agent" ? "stripped" : "own_loop";
  const explanation = eligible
    ? "Task uses locked dependencies without external network, untrusted packages, or an untrusted dev server. Tier C may run it with the yellow weaker-sandbox badge."
    : `Tier C refuses this task (${blocks.join(", ")}). Dependency installs, untrusted dev servers, and tasks that touch the network or untrusted packages require Tier A, Tier B, or Tier D.`;

  return {
    eligible,
    badge: "weaker_sandbox_yellow",
    blocks,
    requiredTiers: eligible ? [] : ["A", "B", "D"],
    wrappedForbidden,
    forcedMode,
    explanation,
  };
}
