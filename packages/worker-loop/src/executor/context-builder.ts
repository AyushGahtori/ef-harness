import { createHash } from "node:crypto";
import { canonicalJson } from "./normalize.js";
import type { BuiltContext, ContextBuildInput, ContextBuilderPort, ContextBuildResult } from "./ports.js";

const ZONES = ["kernel", "must", "should", "working_memory", "history", "tail"] as const;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function renderHistory(input: ContextBuildInput): string {
  if (input.contradiction) {
    const ref = input.wipRef ?? "(none)";
    return [
      "[zone:history]",
      "Fresh conversation after a contradictory brief change.",
      `WIP diff from ${ref}:`,
      input.wipDiff ?? "(empty)",
    ].join("\n");
  }
  const lines = ["[zone:history]"];
  for (const step of input.history) {
    lines.push(
      `step ${step.step} tool=${step.toolCall ?? "(none)"} result=${step.resultSummary ?? ""}`,
    );
    if (step.items.length > 0) lines.push(`items ${canonicalJson(step.items)}`);
  }
  if (input.wipDiff) {
    lines.push(`WIP diff from ${input.wipRef ?? "(none)"}:`);
    lines.push(input.wipDiff);
  }
  return lines.join("\n");
}

/**
 * Local stand-in for Task 054 `WorkerContextBuilder`.
 * Zones stay in pinned order. Zones 1 and 2 do not include the step counter.
 */
export class LocalSixZoneContextBuilder implements ContextBuilderPort {
  buildRequest(input: ContextBuildInput): ContextBuildResult {
    const kernel = `[zone:kernel]\n${input.packet.kernelRules}\nrole: leaf-worker`;
    const must = `[zone:must]\nbrief ${input.briefVersion}\n${input.packet.goal}\n${input.packet.must.join("\n")}`;
    const should = input.contextOverflow
      ? "[zone:should]\n"
      : `[zone:should]\n${input.packet.should.join("\n")}`;
    const memory = `[zone:working_memory]\n${canonicalJson(input.workingMemory)}`;
    const steer = input.steerNotice ? `\nsteer: ${input.steerNotice}` : "";
    const tail = [
      "[zone:tail]",
      `MUST ${input.packet.must.join(" | ")}`,
      `checks ${input.packet.checks.join(",")}`,
      `write scope ${input.packet.writeScope.join(",")}`,
      `step ${input.step}${steer}`,
    ].join("\n");
    const pinnedTokens = estimateTokens(`${kernel}\n${must}\n${tail}`);
    if (pinnedTokens > input.profile.contextWindow) {
      return {
        status: "task_too_large_for_model",
        mustTokens: pinnedTokens,
        windowTokens: input.profile.contextWindow,
      };
    }
    const history = renderHistory(input);
    const body = `${kernel}\n${must}\n${should}\n${memory}\n${history}\n${tail}`;
    if (
      input.contextOverflow &&
      estimateTokens(body) > input.profile.contextWindow
    ) {
      return {
        status: "park_after_context_overflow",
        mustTokens: pinnedTokens,
        windowTokens: input.profile.contextWindow,
      };
    }
    const built: BuiltContext = {
      status: "ok",
      requestDigest: createHash("sha256").update(body).digest("hex"),
      body,
      zones: ZONES,
      rebuiltFromContradiction: input.contradiction,
      briefVersion: input.briefVersion,
      replayItems: input.contradiction ? [] : input.history.flatMap((step) => [...step.items]),
      store: false,
      tightened: input.contextOverflow,
    };
    return built;
  }
}
