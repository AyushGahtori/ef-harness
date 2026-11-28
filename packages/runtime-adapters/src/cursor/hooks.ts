import { decideBeforeShell, decidePreToolUse } from "./policy.js";
import type { BeforeShellInput, HookDecision, HookScope, PreToolUseInput } from "./types.js";
import { parseAgentUsage, parseRunUsage, shouldPauseForOnDemand, usedPpm } from "./usage.js";

export class CursorUsageAndHookController {
  constructor(private readonly scope: HookScope) {}

  preToolUse(input: PreToolUseInput): HookDecision {
    return withElapsed(() => decidePreToolUse(this.scope, input));
  }

  beforeShellExecution(input: BeforeShellInput): HookDecision {
    return withElapsed(() => decideBeforeShell(this.scope, input));
  }

  parseRunUsage(raw: unknown, partialInterrupted = false) {
    return parseRunUsage(raw, partialInterrupted);
  }

  parseAgentUsage(raw: unknown) {
    return parseAgentUsage(raw);
  }

  shouldPauseForOnDemand(quota: Parameters<typeof shouldPauseForOnDemand>[0]): boolean {
    return shouldPauseForOnDemand(quota);
  }

  toPacingSample(quota: Parameters<typeof usedPpm>[0]) {
    return {
      windowKind: "cursor_included" as const,
      usedPpm: usedPpm(quota),
      source: "Agent.getUsage" as const,
      onDemandEnabled: quota.onDemandEnabled,
      chargedCents: quota.chargedCents,
    };
  }
}

function withElapsed(decide: () => Omit<HookDecision, "elapsedMs">): HookDecision {
  const started = performance.now();
  const decision = decide();
  return { ...decision, elapsedMs: performance.now() - started };
}
