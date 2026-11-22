import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { decideLockSafety, type ProcessProbePort } from "./ports.js";
import type { AttemptRecord } from "./types.js";

export interface AppliedRecord {
  readonly type: string;
  readonly detail: string;
}

export interface ReentryStateStore {
  readonly projectId: string;
  readonly snapshotId: string;
  readonly integrationHead: string;
  projectRoot: string;
  attempts: readonly AttemptRecord[];
  readonly closedQuestionIds: readonly string[];
  readonly verifiedTaskIds: readonly string[];
  readonly importedViews: readonly string[];
  readonly includedCommits: readonly string[];
  readonly lockfileIncluded: boolean;
  readonly branchChoice: string | null;
  readonly retiredQuestionIds: readonly string[];
  readonly verifiedHumanStepIds: readonly string[];
  readonly conformanceRequests: readonly string[];
  readonly worktreeRecreateIntents: readonly string[];
  readonly removedLocks: readonly string[];
  readonly applied: readonly AppliedRecord[];
  markCheckpointed(attemptIds: readonly string[]): void;
  closeQuestions(ids: readonly string[]): void;
  verifyTasks(ids: readonly string[]): void;
  importViews(paths: readonly string[]): void;
  includeCommits(shas: readonly string[]): void;
  includeLockfile(): void;
  chooseBranch(choice: string): void;
  relocate(nextRoot: string): void;
  retireQuestions(ids: readonly string[]): void;
  recordHumanSteps(ids: readonly string[]): void;
  recordConformance(requests: readonly string[]): void;
  recordWorktreeRecreate(slotIds: readonly string[]): void;
  noteLockRemoved(lockPath: string): void;
  noteApplied(record: AppliedRecord): void;
  snapshot(): string;
  restore(snapshot: string): void;
}

interface MutableState {
  projectId: string;
  snapshotId: string;
  integrationHead: string;
  projectRoot: string;
  attempts: AttemptRecord[];
  closedQuestionIds: string[];
  verifiedTaskIds: string[];
  importedViews: string[];
  includedCommits: string[];
  lockfileIncluded: boolean;
  branchChoice: string | null;
  retiredQuestionIds: string[];
  verifiedHumanStepIds: string[];
  conformanceRequests: string[];
  worktreeRecreateIntents: string[];
  removedLocks: string[];
  applied: AppliedRecord[];
}

export class InMemoryReentryStore implements ReentryStateStore {
  failOn: string | null = null;
  private state: MutableState;

  constructor(initial: {
    readonly projectId: string;
    readonly snapshotId: string;
    readonly integrationHead: string;
    readonly projectRoot: string;
    readonly attempts: readonly AttemptRecord[];
  }) {
    this.state = {
      projectId: initial.projectId,
      snapshotId: initial.snapshotId,
      integrationHead: initial.integrationHead,
      projectRoot: initial.projectRoot,
      attempts: initial.attempts.map((attempt) => ({ ...attempt })),
      closedQuestionIds: [],
      verifiedTaskIds: [],
      importedViews: [],
      includedCommits: [],
      lockfileIncluded: false,
      branchChoice: null,
      retiredQuestionIds: [],
      verifiedHumanStepIds: [],
      conformanceRequests: [],
      worktreeRecreateIntents: [],
      removedLocks: [],
      applied: [],
    };
  }

  get projectId(): string {
    return this.state.projectId;
  }

  get snapshotId(): string {
    return this.state.snapshotId;
  }

  get integrationHead(): string {
    return this.state.integrationHead;
  }

  get projectRoot(): string {
    return this.state.projectRoot;
  }

  set projectRoot(value: string) {
    this.state.projectRoot = value;
  }

  get attempts(): readonly AttemptRecord[] {
    return this.state.attempts;
  }

  set attempts(value: readonly AttemptRecord[]) {
    this.state.attempts = value.map((attempt) => ({ ...attempt }));
  }

  get closedQuestionIds(): readonly string[] {
    return this.state.closedQuestionIds;
  }

  get verifiedTaskIds(): readonly string[] {
    return this.state.verifiedTaskIds;
  }

  get importedViews(): readonly string[] {
    return this.state.importedViews;
  }

  get includedCommits(): readonly string[] {
    return this.state.includedCommits;
  }

  get lockfileIncluded(): boolean {
    return this.state.lockfileIncluded;
  }

  get branchChoice(): string | null {
    return this.state.branchChoice;
  }

  get retiredQuestionIds(): readonly string[] {
    return this.state.retiredQuestionIds;
  }

  get verifiedHumanStepIds(): readonly string[] {
    return this.state.verifiedHumanStepIds;
  }

  get conformanceRequests(): readonly string[] {
    return this.state.conformanceRequests;
  }

  get worktreeRecreateIntents(): readonly string[] {
    return this.state.worktreeRecreateIntents;
  }

  get removedLocks(): readonly string[] {
    return this.state.removedLocks;
  }

  get applied(): readonly AppliedRecord[] {
    return this.state.applied;
  }

  markCheckpointed(attemptIds: readonly string[]): void {
    this.guard("recover_orphaned_attempts");
    const wanted = new Set(attemptIds);
    this.state.attempts = this.state.attempts.map((attempt) => {
      if (!wanted.has(attempt.id)) return attempt;
      return { ...attempt, status: "CHECKPOINTED", wipDiffPreserved: true };
    });
  }

  closeQuestions(ids: readonly string[]): void {
    this.guard("resolve_commit_answered");
    this.state.closedQuestionIds = unique([...this.state.closedQuestionIds, ...ids]);
  }

  verifyTasks(ids: readonly string[]): void {
    this.guard("verify_tasks");
    this.state.verifiedTaskIds = unique([...this.state.verifiedTaskIds, ...ids]);
  }

  importViews(paths: readonly string[]): void {
    this.guard("import_view_edits");
    this.state.importedViews = unique([...this.state.importedViews, ...paths]);
  }

  includeCommits(shas: readonly string[]): void {
    this.guard("include_manual_commits");
    this.state.includedCommits = unique([...this.state.includedCommits, ...shas]);
  }

  includeLockfile(): void {
    this.guard("include_lockfile");
    this.state.lockfileIncluded = true;
  }

  chooseBranch(choice: string): void {
    this.guard("choose_branch");
    this.state.branchChoice = choice;
  }

  relocate(nextRoot: string): void {
    this.guard("relocate_project_folder");
    this.state.projectRoot = nextRoot;
  }

  retireQuestions(ids: readonly string[]): void {
    this.guard("retire_obsolete_question");
    this.state.retiredQuestionIds = unique([...this.state.retiredQuestionIds, ...ids]);
  }

  recordHumanSteps(ids: readonly string[]): void {
    this.guard("record_verified_human_step");
    this.state.verifiedHumanStepIds = unique([...this.state.verifiedHumanStepIds, ...ids]);
  }

  recordConformance(requests: readonly string[]): void {
    this.guard("request_cli_conformance");
    this.state.conformanceRequests = unique([...this.state.conformanceRequests, ...requests]);
  }

  recordWorktreeRecreate(slotIds: readonly string[]): void {
    this.guard("recreate_worktree");
    this.state.worktreeRecreateIntents = unique([...this.state.worktreeRecreateIntents, ...slotIds]);
  }

  noteLockRemoved(lockPath: string): void {
    this.state.removedLocks = unique([...this.state.removedLocks, lockPath]);
  }

  noteApplied(record: AppliedRecord): void {
    this.state.applied = [...this.state.applied, record];
  }

  snapshot(): string {
    return JSON.stringify(this.state);
  }

  restore(snapshot: string): void {
    const parsed: unknown = JSON.parse(snapshot);
    if (!isMutableState(parsed)) throw new Error("Refusing to restore an unreadable re-entry snapshot");
    this.state = parsed;
  }

  private guard(type: string): void {
    if (this.failOn === type) throw new Error(`forced failure on ${type}`);
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isMutableState(value: unknown): value is MutableState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<MutableState>;
  return typeof record.projectId === "string" && typeof record.snapshotId === "string" && Array.isArray(record.attempts);
}

export interface IndexLockPort {
  assess(lockPath: string): { readonly safe: boolean; readonly reason: string };
  remove(lockPath: string): void;
  restore(lockPath: string): void;
}

export function createFileIndexLockPort(processes: ProcessProbePort): IndexLockPort {
  const backups = new Map<string, Buffer | null>();
  const assess = (lockPath: string) => {
    const present = existsSync(lockPath);
    const ageMs = present ? Date.now() - statSync(lockPath).mtimeMs : null;
    return decideLockSafety({
      present,
      ageMs,
      liveGitPids: processes.liveGitPids(),
      probeReliable: processes.reliable,
    });
  };
  return {
    assess,
    remove(lockPath) {
      const decision = assess(lockPath);
      if (!decision.safe) throw new Error(`Refusing to delete a live git lock: ${lockPath}`);
      if (!existsSync(lockPath)) {
        backups.set(lockPath, null);
        return;
      }
      backups.set(lockPath, readFileSync(lockPath));
      rmSync(lockPath);
    },
    restore(lockPath) {
      if (!backups.has(lockPath)) return;
      const bytes = backups.get(lockPath) ?? null;
      if (bytes) writeFileSync(lockPath, bytes);
      backups.delete(lockPath);
    },
  };
}
