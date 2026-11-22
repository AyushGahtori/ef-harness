import { INSPECTOR_SHELL_SLOT } from "./constants.js";
import { AbortScope } from "./abort-scope.js";
import { PinnedBriefReadSetViewer } from "./brief.js";
import { ChecksAndReceiptsTab } from "./checks.js";
import { CreditLimitedStream } from "./credit-stream.js";
import { LazyRangeDiffViewer } from "./diff.js";
import { el, type InspectorElement } from "./elements.js";
import { isAbortError, PinnedBriefMismatchError } from "./errors.js";
import {
  attemptLabel,
  editorCommand,
  escalationLine,
  formatElapsed,
  formatSpend,
  identityTitle,
  modelBadge,
  waitingLine,
} from "./format.js";
import { ResidentLedger } from "./memory.js";
import { OptInRawStreamTab } from "./raw-stream.js";
import { displayText } from "./redaction.js";
import { StructuredAttemptTimeline, type TimelineState } from "./timeline.js";
import type { InspectorDependencies } from "./ports.js";
import type {
  AttemptSnapshot,
  DiffLayout,
  HandoffHop,
  HandoffRead,
  InspectorApplyResult,
  InspectorSelectionProps,
  InspectorTab,
  InspectorTaskSnapshot,
  PinnedBrief,
} from "./types.js";

const TABS: readonly { id: InspectorTab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "diff", label: "Diff" },
  { id: "checks", label: "Checks" },
  { id: "brief", label: "Brief" },
  { id: "raw", label: "Raw Stream" },
];

/**
 * Five-tab worker inspector. Mounted by Task 122's collapsible shell or a
 * Task 123 pop-out. Heavy diff, log, and screenshot bytes stay on the credit path.
 */
export class WorkerInspectorPanel {
  private readonly scope = new AbortScope();
  private readonly ledger = new ResidentLedger();
  private readonly timeline = new StructuredAttemptTimeline();
  private readonly diff: LazyRangeDiffViewer;
  private readonly checks: ChecksAndReceiptsTab;
  private readonly briefView = new PinnedBriefReadSetViewer();
  private readonly raw: OptInRawStreamTab;

  private selection: InspectorSelectionProps | null = null;
  private snapshot: InspectorTaskSnapshot | null = null;
  private activeAttemptId: string | null = null;
  private tab: InspectorTab = "timeline";
  private brief: PinnedBrief | null = null;
  private briefError: string | null = null;
  private upcoming = false;
  private handoffReads: readonly HandoffRead[] = [];
  private explainText: string | null = null;

  constructor(private readonly deps: InspectorDependencies) {
    const binary = new CreditLimitedStream(deps.binary);
    this.diff = new LazyRangeDiffViewer(binary, this.ledger);
    this.checks = new ChecksAndReceiptsTab(binary, this.ledger);
    this.raw = new OptInRawStreamTab(deps.logs, binary, this.ledger);
  }

  async show(selection: InspectorSelectionProps): Promise<InspectorApplyResult> {
    this.selection = selection;
    const scope = this.scope.reset();
    this.clearDetails();
    const live = (): boolean => this.scope.isCurrent(scope.generation, scope.signal);
    try {
      const snapshot = await this.deps.catalog.load(selection.taskId, scope.signal);
      if (!live()) return { applied: false };
      this.snapshot = snapshot;
      const attempt = pickAttempt(snapshot, selection.attemptId);
      this.activeAttemptId = attempt?.attemptId ?? null;
      this.applyAttempt(snapshot, attempt);
      await this.loadBrief(selection.taskId, attempt, scope.signal, live);
      if (!live()) return { applied: false };
      return { applied: true };
    } catch (error) {
      if (isAbortError(error) || !live()) return { applied: false };
      if (error instanceof PinnedBriefMismatchError) {
        this.brief = null;
        this.briefError = error.message;
        return { applied: true };
      }
      throw error;
    }
  }

  setTab(tab: InspectorTab): void {
    this.tab = tab;
  }

  async selectAttempt(attemptId: string): Promise<InspectorApplyResult> {
    if (!this.snapshot || !this.selection) return { applied: false };
    const attempt = this.snapshot.attempts.find((item) => item.attemptId === attemptId);
    if (!attempt) return { applied: false };
    const scope = this.scope.reset();
    const live = (): boolean => this.scope.isCurrent(scope.generation, scope.signal);
    this.activeAttemptId = attempt.attemptId;
    this.brief = null;
    this.briefError = null;
    this.handoffReads = [];
    this.applyAttempt(this.snapshot, attempt);
    try {
      await this.loadBrief(this.selection.taskId, attempt, scope.signal, live);
      if (!live()) return { applied: false };
      return { applied: true };
    } catch (error) {
      if (isAbortError(error) || !live()) return { applied: false };
      throw error;
    }
  }

  pause(): void {
    if (!this.selection) return;
    this.deps.shell.pause(this.selection.taskId);
  }

  explain(): string {
    const evidence: string[] = [];
    const milestones = this.currentAttempt()?.milestones ?? [];
    for (const milestone of milestones.slice(-50)) {
      try {
        evidence.push(displayText(milestone.summary, "explain"));
      } catch {
        evidence.push("Blocked: milestone was not pre-redacted");
      }
    }
    const first = evidence[0] ?? "No structured events yet";
    const last = evidence[evidence.length - 1] ?? first;
    const summary =
      evidence.length === 0 ? "No structured events yet." : `Started with ${first}. Latest: ${last}.`;
    this.explainText = summary;
    if (this.selection) this.deps.shell.explain(this.selection.taskId, summary, evidence);
    return summary;
  }

  fixedItMyself(): void {
    if (!this.selection) return;
    this.deps.shell.fixedItMyself(this.selection.taskId);
  }

  toggleCommand(milestoneId: string): void {
    this.timeline.toggleCommand(milestoneId);
  }

  async loadDiff(filePath: string, hunkOffset = 0): Promise<InspectorApplyResult> {
    if (!this.currentAttempt()) return { applied: false };
    const { signal, live } = this.liveScope();
    const result = await this.diff.loadFile(filePath, hunkOffset, signal, live);
    return { applied: result === "applied" || result === "blocked" };
  }

  setDiffLayout(layout: DiffLayout): void {
    this.diff.setLayout(layout);
  }

  async openScreenshot(checkId: string): Promise<InspectorApplyResult> {
    const { signal, live } = this.liveScope();
    const result = await this.checks.openScreenshot(checkId, signal, live);
    return { applied: result === "applied" };
  }

  closeLightbox(): void {
    this.checks.closeLightbox();
  }

  disputeTest(checkId: string): void {
    if (!this.selection) return;
    this.deps.shell.disputeTest(this.selection.taskId, checkId);
  }

  followRequirement(requirementId: string): void {
    this.deps.shell.openCanvasNode(requirementId);
  }

  followHandoff(handoffId: string): void {
    this.deps.shell.openCanvasNode(handoffId);
  }

  followFile(filePath: string): void {
    const line = this.diff.firstLine(filePath);
    this.deps.shell.openInEditor(editorCommand(filePath, line));
  }

  async toggleRawStream(enabled: boolean): Promise<InspectorApplyResult> {
    const { signal, live } = this.liveScope();
    const result = await this.raw.setOptIn(enabled, signal, live);
    return { applied: result !== "discarded" };
  }

  async scrollRawStream(startLine: number): Promise<InspectorApplyResult> {
    const { signal, live } = this.liveScope();
    const result = await this.raw.scrollTo(startLine, signal, live);
    return { applied: result !== "discarded" };
  }

  async jumpToLive(): Promise<InspectorApplyResult> {
    const { signal, live } = this.liveScope();
    const result = await this.raw.jumpToLive(signal, live);
    return { applied: result !== "discarded" };
  }

  async noteLiveGrowth(): Promise<InspectorApplyResult> {
    const { signal, live } = this.liveScope();
    const result = await this.raw.noteGrowth(signal, live);
    return { applied: result !== "discarded" };
  }

  copyVisibleLog(): void {
    const copied = this.raw.copySnippet();
    if (copied.ok) this.deps.shell.copyText(copied.text);
  }

  residentBytes(): number {
    return this.ledger.total();
  }

  visibleLogLines(): number {
    return this.raw.visibleLineCount();
  }

  rawOptedIn(): boolean {
    return this.raw.opted;
  }

  rawPinned(): boolean {
    return this.raw.isPinned;
  }

  view(): InspectorElement {
    if (!this.selection) {
      return el("region", "Worker inspector", "Select a worker");
    }
    const identity = this.snapshot?.identity;
    const children: InspectorElement[] = [
      this.renderHeader(),
      el(
        "tablist",
        "Inspector tabs",
        "",
        TABS.map((tab) =>
          el("tab", tab.label, "", [], { selected: this.tab === tab.id, tab: tab.id }),
        ),
      ),
      this.renderTab(),
    ];
    return el("region", "Worker inspector", identity ? identityTitle(identity.agentId, identity.title) : "", children, {
      host: this.selection.host,
      shell: INSPECTOR_SHELL_SLOT.shell,
      minPx: INSPECTOR_SHELL_SLOT.minPx,
      maxPx: INSPECTOR_SHELL_SLOT.maxPx,
      taskId: this.selection.taskId,
    });
  }

  private renderHeader(): InspectorElement {
    const identity = this.snapshot?.identity;
    const attempt = this.currentAttempt();
    const children: InspectorElement[] = [
      el("button", "Pause", "Pause"),
      el("button", "Explain", "Explain"),
      el("button", "I fixed it myself", "I fixed it myself"),
    ];
    if (!identity) {
      return el("header", this.selection?.taskId ?? "Worker", "Loading worker", children);
    }
    const title = identityTitle(identity.agentId, identity.title);
    children.unshift(el("note", "Model", modelBadge(identity.model, identity.connection)));
    children.unshift(el("note", "Level", identity.level));
    if (identity.lane === "Queued") {
      children.push(
        el(
          "note",
          "Estimate",
          `Estimated ${identity.estimatedLevel} · ${formatSpend(identity.estimatedCostMicroUsd)}`,
        ),
      );
      if (identity.waitingOn.length > 0) {
        children.push(el("note", "Waiting", waitingLine(identity.waitingOn)));
      }
    } else {
      children.push(el("note", "Elapsed", formatElapsed(identity.elapsedMs)));
      children.push(el("note", "Spend", formatSpend(identity.spendMicroUsd)));
    }
    children.push(el("note", "Lane", identity.lane));
    if (identity.holdReason) {
      children.push(el("note", "Hold", `Held: ${identity.holdReason}`));
    }
    if (attempt?.hint && attempt.outcome === "failed") {
      children.push(el("note", "Failure hint", attempt.hint));
    }
    if (attempt?.escalatedFrom) {
      children.push(el("note", "Escalation", escalationLine(attempt.escalatedFrom, attempt.level)));
    }
    if (this.explainText) children.push(el("note", "Explain summary", this.explainText));
    if (this.snapshot && this.snapshot.attempts.length > 0) {
      children.push(
        el(
          "radiogroup",
          "Attempts",
          "",
          this.snapshot.attempts.map((item) =>
            el("radio", attemptLabel(item), "", [], {
              selected: item.attemptId === this.activeAttemptId,
              attemptId: item.attemptId,
            }),
          ),
        ),
      );
    }
    return el("header", title, identity.lane, children);
  }

  private renderTab(): InspectorElement {
    if (this.tab === "timeline") return this.timeline.render();
    if (this.tab === "diff") return this.diff.render();
    if (this.tab === "checks") return this.checks.render();
    if (this.tab === "brief") {
      return this.briefView.render({
        brief: this.brief,
        handoffReads: this.handoffReads,
        upcoming: this.upcoming,
        error: this.briefError,
      });
    }
    return this.raw.render();
  }

  private applyAttempt(snapshot: InspectorTaskSnapshot, attempt: AttemptSnapshot | null): void {
    this.timeline.setState(this.timelineState(snapshot));
    this.diff.setFiles(attempt?.attemptId ?? "", attempt?.files ?? []);
    this.checks.setReceipts(attempt?.checks ?? [], retriesInProgress(snapshot.attempts));
    this.raw.setArtifact(attempt?.logArtifactId ?? null);
  }

  private async loadBrief(
    taskId: string,
    attempt: AttemptSnapshot | null,
    signal: AbortSignal,
    live: () => boolean,
  ): Promise<void> {
    this.handoffReads = [];
    if (attempt?.sliceSha256) {
      const brief = await this.deps.slicer.pinnedManifest(attempt.sliceSha256, signal);
      if (!live()) return;
      if (brief.sliceSha256 !== attempt.sliceSha256) {
        throw new PinnedBriefMismatchError(attempt.sliceSha256, brief.sliceSha256);
      }
      const reads = await this.deps.handoffs.readsForAttempt(attempt.attemptId, signal);
      if (!live()) return;
      this.brief = brief;
      this.handoffReads = reads;
      this.briefError = null;
      this.upcoming = false;
      return;
    }
    const brief = await this.deps.slicer.previewManifest(taskId, signal);
    if (!live()) return;
    this.brief = brief;
    this.handoffReads = [];
    this.briefError = null;
    this.upcoming = true;
  }

  private timelineState(snapshot: InspectorTaskSnapshot): TimelineState {
    const lineage = new Map<string, readonly HandoffHop[]>();
    for (const attempt of snapshot.attempts) {
      for (const milestone of attempt.milestones) {
        if (!milestone.handoffId || lineage.has(milestone.handoffId)) continue;
        lineage.set(milestone.handoffId, this.deps.handoffs.lineage(milestone.handoffId));
      }
    }
    return {
      attempts: snapshot.attempts,
      selectedAttemptId: this.activeAttemptId,
      emptyMessage: this.emptyMessage(snapshot),
      lineage,
    };
  }

  private emptyMessage(snapshot: InspectorTaskSnapshot): string | null {
    if (snapshot.attempts.length > 0) return null;
    if (!snapshot.identity.phase0GateOpen) return "Waiting on Phase 0 Gate 0";
    if (snapshot.identity.waitingOn.length > 0) return waitingLine(snapshot.identity.waitingOn);
    return "Queued";
  }

  private clearDetails(): void {
    this.snapshot = null;
    this.activeAttemptId = null;
    this.brief = null;
    this.briefError = null;
    this.upcoming = false;
    this.handoffReads = [];
    this.explainText = null;
    this.timeline.setState({
      attempts: [],
      selectedAttemptId: null,
      emptyMessage: "Loading worker",
      lineage: new Map(),
    });
    this.diff.discard();
    this.checks.discard();
    this.raw.discard();
  }

  private currentAttempt(): AttemptSnapshot | null {
    if (!this.snapshot || !this.activeAttemptId) return null;
    return this.snapshot.attempts.find((item) => item.attemptId === this.activeAttemptId) ?? null;
  }

  private liveScope(): { signal: AbortSignal; live: () => boolean } {
    const scope = this.scope.current();
    return {
      signal: scope.signal,
      live: () => this.scope.isCurrent(scope.generation, scope.signal),
    };
  }
}

function pickAttempt(
  snapshot: InspectorTaskSnapshot,
  attemptId: string | undefined,
): AttemptSnapshot | null {
  if (snapshot.attempts.length === 0) return null;
  if (attemptId) {
    return snapshot.attempts.find((item) => item.attemptId === attemptId) ?? snapshot.attempts.at(-1) ?? null;
  }
  return snapshot.attempts.at(-1) ?? null;
}

function retriesInProgress(attempts: readonly AttemptSnapshot[]): boolean {
  const latest = attempts.at(-1);
  if (!latest) return false;
  return latest.outcome !== "pass";
}
