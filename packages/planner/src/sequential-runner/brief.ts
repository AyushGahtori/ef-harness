import { canonicalize, countTokens, sha256Hex } from "./canonical.js";
import { StateDb } from "./state-db.js";
import {
  WORKER_TOOLS,
  type BriefManifest,
  type KnowledgePacketSlicerPort,
  type MaterializedBrief,
  type ReadyTask,
  type SliceCompileInput,
} from "./types.js";

export class LocalKnowledgePacketSlicer implements KnowledgePacketSlicerPort {
  compile(input: SliceCompileInput): MaterializedBrief {
    const nodes = [...input.nodes].sort((left, right) => compareText(left.id, right.id));
    const sliceSha256 = sha256Hex(
      canonicalize({
        hint: input.hint,
        level: input.task.level,
        nodes: nodes.map((node) => ({ contentHash: node.contentHash, id: node.id, version: node.version })),
        taskId: input.task.id,
      }),
    );
    const tags = input.task.fields.tags ?? [];
    const text = [
      `# Task ${input.task.id}`,
      input.task.title,
      input.task.text,
      "## Requirements",
      ...(input.requirementLines.length > 0 ? input.requirementLines : ["(none)"]),
      "## Write scope",
      tags.length > 0 ? tags.join(", ") : "(none)",
      "## Tools",
      WORKER_TOOLS.join(", "),
      "## Hint",
      input.hint || "none",
    ].join("\n");
    const tokens = countTokens(text);
    const manifest: BriefManifest = {
      taskId: input.task.id,
      attemptId: input.attemptId,
      level: input.task.level,
      tokens,
      sliceSha256,
      nodes,
      tools: WORKER_TOOLS,
      hint: input.hint,
    };
    return { text, tokens, sliceSha256, manifest };
  }
}

export class AttemptBriefMaterializer {
  constructor(
    private readonly db: StateDb,
    private readonly slicer: KnowledgePacketSlicerPort,
  ) {}

  materialize(task: ReadyTask, attemptId: string, hint: string, now: number): MaterializedBrief {
    const brief = this.slicer.compile({
      task,
      attemptId,
      hint,
      nodes: this.db.pinnedNodes(task.id),
      requirementLines: this.db.requirementLines(task.id),
    });
    this.db.writeCheckpoint({
      attemptId,
      step: 0,
      wipRef: null,
      manifestJson: JSON.stringify(brief.manifest),
      briefText: brief.text,
      now,
    });
    return brief;
  }
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
