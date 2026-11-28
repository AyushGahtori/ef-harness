import type { GitTreeSafety } from "./git-work.js";
import type { BriefCompilerPort, ForeignAdapterPort } from "./ports.js";
import type { CompiledBrief, DeltaKind, ForeignRuntimeCheckpoint } from "./types.js";
import { freshSessionTimeline } from "./types.js";
import { buildLabeledWipHandoff, type HandoffFile } from "./wip-label.js";

export interface RebuildInput {
  readonly checkpoint: ForeignRuntimeCheckpoint;
  readonly brief: CompiledBrief;
  readonly adapter: ForeignAdapterPort;
  readonly slotPath: string;
  readonly kind: DeltaKind;
  readonly contradictedTokens: readonly string[];
  readonly switched: boolean;
}

export interface RebuildResult {
  readonly sessionId: string;
  readonly pid: number;
  readonly wipTreeSha: string;
  readonly restoredTreeSha: string;
  readonly handoff: string;
  readonly tokens: number;
  readonly brief: CompiledBrief;
  readonly wipedPaths: readonly string[];
  readonly keptPaths: readonly string[];
  readonly timelineMessage: string;
  readonly baseNote: string | null;
}

/**
 * Fresh session plus an explicitly labeled, unverified WIP diff.
 * Contradictory history is never replayed. Non-conflicting edits are kept and labeled.
 */
export class LabeledWipFreshSessionRebuilder {
  constructor(
    private readonly trees: GitTreeSafety,
    private readonly briefs: BriefCompilerPort,
  ) {}

  async rebuild(input: RebuildInput): Promise<RebuildResult> {
    const repoPath = input.checkpoint.worktreePath;
    const integrationSha = this.trees.integrationHead(repoPath);
    const verification = this.trees.verify({
      repoPath,
      pinnedBaseCommitSha: input.checkpoint.pinnedBaseCommitSha,
      wipTreeSha: input.checkpoint.wipTreeSha,
      integrationSha,
    });
    const compiled = this.briefs.compile(input.brief);
    const usable = verification.exists && !verification.conflict;
    const changed = usable
      ? this.trees.changedFiles({
          repoPath,
          baseCommitSha: input.checkpoint.pinnedBaseCommitSha,
          wipTreeSha: input.checkpoint.wipTreeSha,
          contradictedTokens: input.kind === "contradictory" ? input.contradictedTokens : [],
        })
      : [];
    const wipedPaths =
      input.kind === "contradictory" ? changed.filter((file) => file.contradicted).map((file) => file.path) : [];
    const kept = input.kind === "contradictory" ? changed.filter((file) => !file.contradicted) : changed;
    const restoredTreeSha = this.chooseTree({
      repoPath,
      integrationSha,
      checkpoint: input.checkpoint,
      kind: input.kind,
      usable,
      mergedTreeSha: verification.mergedTreeSha,
      keptPaths: kept.filter((file) => file.status !== "D").map((file) => file.path),
      removePaths: kept.filter((file) => file.status === "D").map((file) => file.path),
      wipedEverything: input.kind === "contradictory" && kept.length === 0,
    });
    this.trees.materialize(repoPath, restoredTreeSha, input.slotPath);
    const files: HandoffFile[] = (usable ? kept : []).map((file) => ({
      path: file.path,
      bytes: file.bytes,
      lines: file.lines,
      excerpt: file.excerpt,
    }));
    const handoff = buildLabeledWipHandoff({
      files,
      wipedPaths,
      lastFailingCheck: input.checkpoint.lastVerificationError,
      note: verification.note,
    });
    const started = await input.adapter.startSession({
      attemptId: input.checkpoint.attemptId,
      brief: compiled,
      handoff: handoff.text,
      worktreePath: repoPath,
      wipTreeSha: input.checkpoint.wipTreeSha,
      slotPath: input.slotPath,
    });
    return {
      sessionId: started.sessionId,
      pid: started.pid,
      wipTreeSha: input.checkpoint.wipTreeSha,
      restoredTreeSha,
      handoff: handoff.text,
      tokens: handoff.tokens,
      brief: compiled,
      wipedPaths,
      keptPaths: kept.map((file) => file.path),
      timelineMessage: freshSessionTimeline(input.adapter.adapterId, input.switched),
      baseNote: verification.note,
    };
  }

  private chooseTree(input: {
    readonly repoPath: string;
    readonly integrationSha: string;
    readonly checkpoint: ForeignRuntimeCheckpoint;
    readonly kind: DeltaKind;
    readonly usable: boolean;
    readonly mergedTreeSha: string | null;
    readonly keptPaths: readonly string[];
    readonly removePaths: readonly string[];
    readonly wipedEverything: boolean;
  }): string {
    const integrationTree = this.trees.treeOfCommit(input.repoPath, input.integrationSha);
    if (!input.usable || input.wipedEverything) return integrationTree;
    if (input.kind === "contradictory") {
      return this.trees.composeTree({
        repoPath: input.repoPath,
        baseTreeSha: integrationTree,
        wipTreeSha: input.checkpoint.wipTreeSha,
        overlayPaths: input.keptPaths,
        removePaths: input.removePaths,
      });
    }
    return input.mergedTreeSha ?? input.checkpoint.wipTreeSha;
  }
}
