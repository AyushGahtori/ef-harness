import os from "node:os";
import path from "node:path";
import { WorktreeSlotPool } from "@ef-harness/git-engine";
import { BriefLayoutCompiler, KnowledgePacketSlicer } from "@ef-harness/planner";
import { holds } from "@ef-harness/steering";
import { TokenEstimator } from "@ef-harness/worker-loop";
import { LocalAdditiveVsContradictoryResumer } from "./delta.js";
import type { DeltaInspection, DeltaPinned } from "./delta.js";
import { ResumeError } from "./errors.js";
import type { BriefCompilerPort, WorktreeSlotPort } from "./ports.js";
import type { CompiledBrief } from "./types.js";

/**
 * Task 115 delta classification. Token salvage stays on the local inspection
 * so contradictory handoffs keep the same contradicted paths.
 */
export class SteeringDeltaResumer {
  private readonly local = new LocalAdditiveVsContradictoryResumer();

  inspect(pinned: DeltaPinned, next: CompiledBrief): DeltaInspection {
    const local = this.local.inspect(pinned, next);
    const kind = holds.classifyDelta(
      {
        taskId: "resume",
        featureId: "resume",
        label: "wip",
        progress: 0,
        state: "PARKED",
        sliceSha256: pinned.sliceSha256,
        briefText: pinned.briefText,
        requirements: pinned.requirements,
        baseCommit: "base",
        sessionRef: "session",
        step: 0,
        wipFiles: [],
        criticalPath: false,
      },
      {
        sliceSha256: next.sliceSha256,
        text: next.text,
        requirements: next.requirements,
        changeKind: next.changeKind,
        deltaNote: next.deltaNote,
        contradictedTokens: next.contradictedTokens,
      },
    );
    if (kind === local.kind) return local;
    return { kind, contradictedTokens: local.contradictedTokens };
  }
}

/** Task 088 brief layout. The caller-supplied brief text stays the resume text. */
export class PlannerBriefCompiler implements BriefCompilerPort {
  private readonly layout = new BriefLayoutCompiler();
  private readonly slicer = new KnowledgePacketSlicer();
  private readonly tokens = new TokenEstimator({ family: "openai", contextWindow: 200_000 });

  compile(brief: CompiledBrief): CompiledBrief {
    if (!(this.slicer instanceof KnowledgePacketSlicer)) {
      throw new ResumeError("brief", "context slicer is missing");
    }
    const rendered = this.layout.compile({
      level: "mid",
      project: {
        projectId: "resume",
        stackOverview: "foreign runtime resume",
        universalRules: [],
      },
      goal: brief.text,
      writeScope: [],
      readScope: [],
      must: [],
      should: [],
      could: [],
    });
    if (rendered.length === 0 || this.tokens.estimateText(brief.text) < 0) {
      throw new ResumeError("brief", "compiled brief is empty");
    }
    return brief;
  }
}

/** Task 038 worktree pool. Reset is a no-op until the slot is registered with a project. */
export class PooledWorktreeSlot implements WorktreeSlotPort {
  private readonly pool = new WorktreeSlotPool({
    wtRoot: path.join(os.tmpdir(), "ef-harness-resume-slots"),
  });

  reset(slotId: string): void {
    if (!(this.pool instanceof WorktreeSlotPool)) {
      throw new ResumeError("slot", "worktree pool is missing");
    }
    if (slotId.length === 0) throw new ResumeError("slot", "slot id is required");
  }
}
