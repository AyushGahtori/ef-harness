import { GitRepo } from "./git.js";
import { HumanFixCleanVerifier } from "./clean-verifier.js";
import { HumanScopeAndContractReconciler } from "./scope-reconciler.js";
import { HumanVerificationOverridePolicy } from "./override-policy.js";
import { HumanFixTakeoverController } from "./takeover-controller.js";
import { HumanEditWorkspacePicker } from "./workspace-picker.js";
import type {
  CleanVerifierHarnessPort,
  ActiveScopeOverlapDetectorPort,
  ProjectMergeQueuePort,
  VerificationHintLadderPort,
  WorktreeSlotPoolPort,
} from "./ports.js";
import { HumanFixStateDb } from "./state-db.js";
import type { HandBackRequest, HandBackResult, HumanFixReceipt, MergeHandoff } from "./types.js";
import { CODING, HAND_BACK_TO_AI } from "./constants.js";

export interface HumanFixFlowEngineOptions {
  readonly repo: string;
  readonly stateFile: string;
  readonly mainCheckoutPath?: string;
  readonly verifier: CleanVerifierHarnessPort;
  readonly slots: WorktreeSlotPoolPort;
  readonly overlap: ActiveScopeOverlapDetectorPort;
  readonly mergeQueue: ProjectMergeQueuePort;
  readonly hintLadder: VerificationHintLadderPort;
}

export class HumanFixFlowEngine {
  readonly git: GitRepo;
  readonly state: HumanFixStateDb;
  readonly takeover: HumanFixTakeoverController;
  readonly workspace: HumanEditWorkspacePicker;
  readonly cleanVerifier: HumanFixCleanVerifier;
  readonly reconciler: HumanScopeAndContractReconciler;
  readonly overridePolicy: HumanVerificationOverridePolicy;

  constructor(options: HumanFixFlowEngineOptions) {
    this.git = new GitRepo(options.repo);
    this.state = HumanFixStateDb.open(options.stateFile);
    this.takeover = new HumanFixTakeoverController(this.state);
    this.workspace = new HumanEditWorkspacePicker(options.slots, options.mainCheckoutPath ?? options.repo);
    this.cleanVerifier = new HumanFixCleanVerifier(options.verifier, this.state);
    this.reconciler = new HumanScopeAndContractReconciler(this.state, options.overlap);
    this.overridePolicy = new HumanVerificationOverridePolicy(
      this.state,
      options.verifier,
      options.hintLadder,
      options.mergeQueue,
    );
  }

  finishToMerge(taskId: string, commitSha: string): MergeHandoff {
    const author = this.git.parseAuthor(commitSha);
    const unblocked = this.state.unparkDownstream(taskId);
    return {
      taskId,
      commitSha,
      author,
      unblockedDownstreamTaskIds: unblocked,
    };
  }

  handBackToAi(request: HandBackRequest): HandBackResult {
    this.state.requireTask(request.taskId);
    let wip: string | null = null;
    if (request.keepEdits) {
      const identity = this.git.readIdentity();
      wip = this.git.commitWithHumanTrailers(identity, request.taskId, `human wip ${request.taskId}\n\n${request.guidanceNote}`);
      this.state.tagHumanPaths(request.taskId, this.git.diffNameOnly(`${wip}^`, wip));
    }
    this.state.setTaskState(request.taskId, CODING);
    return {
      taskId: request.taskId,
      resumedState: CODING,
      wipCommitSha: wip,
      guidanceNote: request.guidanceNote,
    };
  }

  receipt(taskId: string, commitSha: string): HumanFixReceipt {
    const task = this.state.requireTask(taskId);
    const author = this.git.parseAuthor(commitSha);
    return {
      taskId,
      acceptedBy: "human",
      commitSha,
      verificationStatus: task.verificationStatus || "pass",
      overriddenCheckIds: task.overriddenCheckIds,
      author,
    };
  }

  aiPreservePrompt(taskId: string): string {
    const task = this.state.requireTask(taskId);
    return this.cleanVerifier.preserveAuthorshipHint(this.git.readIdentity(), task.humanAuthoredPaths);
  }

  close(): void {
    this.state.close();
  }
}

export const HAND_BACK_ACTION = HAND_BACK_TO_AI;