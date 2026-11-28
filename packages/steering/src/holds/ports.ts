import type {
  ClarificationCard,
  CompiledBrief,
  HoldVisibilityEntry,
  ImpactWalkResult,
  ReminderPill,
  SignedSteeringNote,
  WipFile,
} from "./types.js";

export interface ReverseImpactWalkerPort {
  walkCombined(startIds: readonly string[]): ImpactWalkResult;
}

export interface InterruptRequest {
  readonly taskId: string;
  readonly sessionRef: string;
  readonly step: number;
  readonly sliceSha256: string;
  readonly briefText: string;
}

export interface StepContinueRequest {
  readonly taskId: string;
  readonly sessionRef: string;
}

export interface ExistingResumeRequest {
  readonly taskId: string;
  readonly sessionRef: string;
}

export interface WarmResumeRequest {
  readonly taskId: string;
  readonly sessionRef: string;
  readonly note: SignedSteeringNote;
  readonly wipFiles: readonly WipFile[];
}

export interface FreshSessionRequest {
  readonly taskId: string;
  readonly previousSessionRef: string;
  readonly brief: CompiledBrief;
  readonly salvagedWip: readonly { readonly path: string; readonly label: string }[];
  readonly discardedWip: readonly string[];
}

export interface FreshSessionResult {
  readonly sessionRef: string;
  readonly previousSessionAppended: false;
}

/**
 * Local stand-in for Task 053 `NativeWorkerLoop` checkpoints and Task 150 foreign resume.
 * None of these methods start a model turn.
 */
export interface WorkerSessionPort {
  interruptAtStepBoundary(input: InterruptRequest): { readonly taskId: string; readonly sessionRef: string; readonly step: number };
  allowCurrentStep(input: StepContinueRequest): void;
  resumeExistingCheckpoint(input: ExistingResumeRequest): { readonly sessionRef: string };
  resumeWithSignedNote(input: WarmResumeRequest): { readonly sessionRef: string };
  reconstructFreshSession(input: FreshSessionRequest): FreshSessionResult;
}

export interface ReverifyInput {
  readonly taskId: string;
  readonly commitSha: string;
  readonly fromBase: string;
  readonly toHead: string;
}

export interface AcceptCandidateInput {
  readonly taskId: string;
  readonly commitSha: string;
  readonly baseHead: string;
  readonly reverified: boolean;
}

/** Local stand-in for Task 060 `CandidateAcceptanceTx`. */
export interface CandidateAcceptancePort {
  reverify(input: ReverifyInput): { readonly ok: boolean; readonly commitSha: string };
  accept(input: AcceptCandidateInput): { readonly landed: true; readonly commitSha: string };
}

export interface InboxPort {
  publishClarification(card: ClarificationCard): void;
  publishReminder(pill: ReminderPill): void;
}

export interface HoldSurfacePort {
  publish(entries: readonly HoldVisibilityEntry[]): void;
}

export class LocalReverseImpactWalker implements ReverseImpactWalkerPort {
  readonly calls: string[][] = [];

  constructor(private readonly edges: ReadonlyMap<string, readonly string[]>) {}

  walkCombined(startIds: readonly string[]): ImpactWalkResult {
    this.calls.push([...startIds]);
    const tasks = new Set<string>();
    for (const startId of startIds) {
      const linked = this.edges.get(startId);
      if (!linked) continue;
      for (const taskId of linked) tasks.add(taskId);
    }
    return {
      affectedActiveTasks: [...tasks].sort(),
      affectedContracts: [],
      partial: false,
    };
  }
}

interface SessionTranscript {
  readonly taskId: string;
  lines: string[];
}

export interface RecordedFreshSession {
  readonly taskId: string;
  readonly previousSessionRef: string;
  readonly sessionRef: string;
  readonly previousSessionAppended: false;
  readonly lines: readonly string[];
  readonly salvagedWip: readonly { readonly path: string; readonly label: string }[];
  readonly discardedWip: readonly string[];
}

export class LocalWorkerSession implements WorkerSessionPort {
  readonly interrupts: InterruptRequest[] = [];
  readonly continued: StepContinueRequest[] = [];
  readonly existingResumes: ExistingResumeRequest[] = [];
  readonly notes: WarmResumeRequest[] = [];
  readonly freshSessions: RecordedFreshSession[] = [];
  readonly sessions = new Map<string, SessionTranscript>();
  modelTurns = 0;

  interruptAtStepBoundary(input: InterruptRequest): { taskId: string; sessionRef: string; step: number } {
    this.interrupts.push(input);
    this.ensure(input.sessionRef, input.taskId, input.briefText);
    return { taskId: input.taskId, sessionRef: input.sessionRef, step: input.step };
  }

  allowCurrentStep(input: StepContinueRequest): void {
    this.continued.push(input);
  }

  resumeExistingCheckpoint(input: ExistingResumeRequest): { sessionRef: string } {
    this.existingResumes.push(input);
    return { sessionRef: input.sessionRef };
  }

  resumeWithSignedNote(input: WarmResumeRequest): { sessionRef: string } {
    this.notes.push(input);
    const session = this.ensure(input.sessionRef, input.taskId, "");
    session.lines.push(input.note.text);
    return { sessionRef: input.sessionRef };
  }

  reconstructFreshSession(input: FreshSessionRequest): FreshSessionResult {
    const previous = this.sessions.get(input.previousSessionRef);
    const previousLines = previous ? [...previous.lines] : [];
    const sessionRef = `${input.previousSessionRef}:fresh:${this.freshSessions.length + 1}`;
    const lines = [input.brief.text, ...input.salvagedWip.map((file) => `${file.label}: ${file.path}`)];
    this.sessions.set(sessionRef, { taskId: input.taskId, lines: [...lines] });
    if (previous) previous.lines.splice(0, previous.lines.length, ...previousLines);
    const recorded: RecordedFreshSession = {
      taskId: input.taskId,
      previousSessionRef: input.previousSessionRef,
      sessionRef,
      previousSessionAppended: false,
      lines,
      salvagedWip: input.salvagedWip,
      discardedWip: input.discardedWip,
    };
    this.freshSessions.push(recorded);
    return { sessionRef, previousSessionAppended: false };
  }

  /** Present so tests can prove the hold engine never asks for a model turn. */
  runModelTurn(): void {
    this.modelTurns += 1;
  }

  private ensure(sessionRef: string, taskId: string, line: string): SessionTranscript {
    const existing = this.sessions.get(sessionRef);
    if (existing) return existing;
    const created: SessionTranscript = { taskId, lines: line.length > 0 ? [line] : [] };
    this.sessions.set(sessionRef, created);
    return created;
  }
}

export interface LandedCandidate {
  readonly taskId: string;
  readonly commitSha: string;
  readonly baseHead: string;
  readonly reverified: boolean;
}

export class LocalCandidateAcceptanceTx implements CandidateAcceptancePort {
  readonly landed: LandedCandidate[] = [];
  readonly reverified: ReverifyInput[] = [];
  reverifyResult: { ok: boolean; commitSha: string } | null = null;

  reverify(input: ReverifyInput): { ok: boolean; commitSha: string } {
    this.reverified.push(input);
    if (this.reverifyResult) return this.reverifyResult;
    return { ok: true, commitSha: input.commitSha };
  }

  accept(input: AcceptCandidateInput): { landed: true; commitSha: string } {
    this.landed.push({
      taskId: input.taskId,
      commitSha: input.commitSha,
      baseHead: input.baseHead,
      reverified: input.reverified,
    });
    return { landed: true, commitSha: input.commitSha };
  }
}

export class LocalInbox implements InboxPort {
  readonly cards: ClarificationCard[] = [];
  readonly reminders: ReminderPill[] = [];

  publishClarification(card: ClarificationCard): void {
    this.cards.push(card);
  }

  publishReminder(pill: ReminderPill): void {
    this.reminders.push(pill);
  }
}

export class LocalHoldSurfaces implements HoldSurfacePort {
  readonly publications: HoldVisibilityEntry[][] = [];

  publish(entries: readonly HoldVisibilityEntry[]): void {
    this.publications.push([...entries]);
  }
}
