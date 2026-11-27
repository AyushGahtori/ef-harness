import { generateHandoffNote } from "./handoff-note.js";
import { collectModelTurn } from "./collect-turn.js";
import { dispatchTool } from "./dispatch-tool.js";
import { countPrefixed, maxStepsFor, nextProgress, repeatWouldStick } from "./guards.js";
import {
  acknowledgesSteer,
  allowedTools,
  canonicalToolName,
  containsCodeFence,
  isAbortError,
  isEditStuckError,
  isEditTool,
  isPrematureDoneClaim,
  pathInScope,
  readTurnFailure,
  repairMessage,
  stringField,
  toolCallRecord,
} from "./normalize.js";
import type {
  BuiltContext,
  CheckpointCommit,
  ContextBuildResult,
  ModelTurnRequest,
  NativeWorkerLoopDependencies,
} from "./ports.js";
import {
  CrashInjectedError,
  MODEL_CALL_RESERVE_UNITS,
  STREAM_STALL_MS,
  UnknownOutcomeReconciliationError,
  toolBody,
  type AttemptExecutionResult,
  type AttemptRecord,
  type AttemptRunState,
  type CrashPoint,
  type CrashSite,
  type PendingEffect,
  type ProviderItem,
  type SteerNotice,
  type TerminalOutcome,
  type ToolBody,
  type ToolCall,
  type TurnFailureView,
} from "./types.js";

interface RecordedResponse {
  itemsArtifact: string;
  requestDigest: string;
  toolCalls: ToolCall[];
  tokensIn: number;
  tokensOut: number;
  text: string;
}

type Signal =
  | { type: "continue" }
  | { type: "terminal"; result: AttemptExecutionResult };

export class NativeWorkerLoop {
  private readonly pause = new Set<string>();
  private readonly stop = new Set<string>();
  private readonly abort = new Map<string, AbortController>();

  constructor(private readonly deps: NativeWorkerLoopDependencies) {}

  pauseAtBoundary(attemptId: string): void {
    this.pause.add(attemptId);
  }

  stopImmediately(attemptId: string): void {
    this.stop.add(attemptId);
    this.abort.get(attemptId)?.abort();
  }

  deliverSteer(attemptId: string, steer: SteerNotice): void {
    if (steer.kind === "hard" || !steer.compatible) {
      this.deps.coordinator.updateAttempt(attemptId, {
        hardSteer: { id: steer.id, text: steer.text },
      });
      return;
    }
    this.deps.coordinator.updateAttempt(attemptId, {
      additiveSteer: { id: steer.id, text: steer.text, acknowledged: false },
    });
  }

  async runAttempt(attemptId: string): Promise<AttemptExecutionResult> {
    return this.drive(attemptId);
  }

  async resumeAttemptFromCheckpoint(attemptId: string): Promise<AttemptExecutionResult> {
    await this.reconcileUnknown(attemptId);
    return this.drive(attemptId);
  }

  private async drive(attemptId: string): Promise<AttemptExecutionResult> {
    await this.reconcileUnknown(attemptId);
    for (;;) {
      const attempt = this.deps.coordinator.getAttempt(attemptId);
      if (attempt.liveEpoch !== attempt.epoch) {
        return this.finish(attemptId, "fenced", "epoch", true);
      }
      const pending = this.cursor(attemptId);
      if (
        pending &&
        (pending.kind === "response_recorded" ||
          pending.kind === "tool_in_flight" ||
          pending.kind === "tool_done_unlogged")
      ) {
        const resumed = await this.resumeCursor(attempt, pending);
        if (resumed.type === "terminal") return resumed.result;
        continue;
      }
      if (pending?.kind === "model_in_flight") this.writeCursor(attempt, []);
      const boundary = this.boundary(attempt);
      if (boundary) return this.finish(attemptId, boundary.outcome, boundary.reason, false);
      const completed = this.deps.coordinator.turns(attemptId).length;
      if (completed >= maxStepsFor(attempt.level, attempt.maxSteps)) {
        return this.finish(attemptId, "stuck", "max_steps", true);
      }
      const built = await this.prepareContext(attempt, completed + 1);
      if (built.status === "task_too_large_for_model") {
        return this.finish(attemptId, "parked", "task_too_large_for_model", true);
      }
      if (built.status === "park_after_context_overflow") {
        return this.finish(attemptId, "parked", "context_overflow", true);
      }
      const request = this.toRequest(attempt, built, completed + 1);
      const invoked = await this.invoke(attempt, request);
      if (invoked.type === "terminal") return invoked.result;
      if (invoked.type === "retry") continue;
      const consumed = await this.consumeResponse(attempt, request, invoked.turn);
      if (consumed.type === "terminal") return consumed.result;
    }
  }

  private async invoke(
    attempt: AttemptRecord,
    request: ModelTurnRequest,
  ): Promise<
    | { type: "terminal"; result: AttemptExecutionResult }
    | { type: "retry" }
    | { type: "turn"; turn: Awaited<ReturnType<typeof collectModelTurn>> }
  > {
    const same = request;
    for (;;) {
      const reservation = await this.deps.budget.reserveAcrossScopes({
        attemptId: attempt.id,
        amountUnits: MODEL_CALL_RESERVE_UNITS,
        purpose: "model_call",
      });
      if (!reservation.ok) {
        return {
          type: "terminal",
          result: await this.finish(attempt.id, "budget_exhausted", "budget", true),
        };
      }
      const site = this.site(attempt.id, null);
      this.writeCursor(this.deps.coordinator.getAttempt(attempt.id), [
        {
          kind: "model_in_flight",
          reservationId: reservation.reservationId,
          requestDigest: same.requestDigest,
          clientRequestId: same.clientRequestId,
        },
      ]);
      if (this.shouldCrash("during_model_call", site)) {
        await this.deps.budget.markReservationUnknown(reservation.reservationId);
        this.deps.crash?.onCrash?.("during_model_call", site);
        throw new CrashInjectedError("during_model_call", site.nextStep, null);
      }
      const controller = new AbortController();
      this.abort.set(attempt.id, controller);
      try {
        if (same.store !== false) {
          throw new Error("native worker requests keep store false");
        }
        const turn = await collectModelTurn(
          this.deps.model.stream(same, {
            signal: controller.signal,
            stallTimeoutMs: STREAM_STALL_MS,
          }),
        );
        this.assertIntegerTokens(turn.tokensIn, turn.tokensOut);
        await this.deps.budget.settleReservation(
          reservation.reservationId,
          turn.tokensIn + turn.tokensOut,
        );
        if (this.stop.has(attempt.id)) {
          this.stop.delete(attempt.id);
          this.writeCursor(this.deps.coordinator.getAttempt(attempt.id), []);
          return {
            type: "terminal",
            result: await this.finish(attempt.id, "parked", "stop", true),
          };
        }
        return { type: "turn", turn };
      } catch (error) {
        if (error instanceof CrashInjectedError) throw error;
        if (this.stop.has(attempt.id) || isAbortError(error)) {
          this.stop.delete(attempt.id);
          await this.releaseIfHeld(reservation.reservationId);
          this.writeCursor(this.deps.coordinator.getAttempt(attempt.id), []);
          return {
            type: "terminal",
            result: await this.finish(attempt.id, "parked", "stop", true),
          };
        }
        const failure = readTurnFailure(error);
        if (!failure) throw error;
        if (failure.kind === "unknown_timeout") {
          await this.deps.budget.markReservationUnknown(reservation.reservationId);
          throw new UnknownOutcomeReconciliationError(failure.clientRequestId, site.nextStep);
        }
        await this.settlePartial(reservation.reservationId, failure);
        this.writeCursor(this.deps.coordinator.getAttempt(attempt.id), []);
        if (failure.kind === "stream_stall") {
          const current = this.deps.coordinator.getAttempt(attempt.id);
          const stalls = (current.stallsByDigest[same.requestDigest] ?? 0) + 1;
          this.deps.coordinator.updateAttempt(attempt.id, {
            stallsByDigest: { ...current.stallsByDigest, [same.requestDigest]: stalls },
          });
          if (stalls >= 2) {
            return {
              type: "terminal",
              result: await this.finish(attempt.id, "parked", "stream_stall", true),
            };
          }
          continue;
        }
        if (failure.kind === "rate_limit") {
          await this.deps.pacing.waitForRateLimit(failure.retryAfterMs ?? 0);
          return { type: "retry" };
        }
        if (failure.kind === "usage_limit") {
          return {
            type: "terminal",
            result: await this.finish(attempt.id, "parked", "usage_limit", true),
          };
        }
        if (failure.kind === "context_overflow") {
          const current = this.deps.coordinator.getAttempt(attempt.id);
          if (current.overflowRetried) {
            return {
              type: "terminal",
              result: await this.finish(attempt.id, "parked", "context_overflow", true),
            };
          }
          this.deps.coordinator.updateAttempt(attempt.id, { overflowRetried: true });
          return { type: "retry" };
        }
        return {
          type: "terminal",
          result: await this.finish(attempt.id, "parked", failure.kind, true),
        };
      } finally {
        this.abort.delete(attempt.id);
      }
    }
  }

  private async consumeResponse(
    attempt: AttemptRecord,
    request: ModelTurnRequest,
    turn: Awaited<ReturnType<typeof collectModelTurn>>,
  ): Promise<Signal> {
    const artifact = `cas:${attempt.id}:${request.requestDigest}`;
    this.deps.coordinator.putItems(artifact, turn.items);
    const recorded: RecordedResponse = {
      itemsArtifact: artifact,
      requestDigest: request.requestDigest,
      toolCalls: turn.toolCalls,
      tokensIn: turn.tokensIn,
      tokensOut: turn.tokensOut,
      text: turn.text,
    };
    this.writeCursor(attempt, [this.responseCursor(recorded, 0)]);
    const site = this.site(attempt.id, null);
    if (this.shouldCrash("after_response_before_tool", site)) {
      this.deps.crash?.onCrash?.("after_response_before_tool", site);
      throw new CrashInjectedError("after_response_before_tool", site.nextStep, null);
    }
    return this.executeTools(this.deps.coordinator.getAttempt(attempt.id), recorded, 0);
  }

  private async executeTools(
    attempt: AttemptRecord,
    response: RecordedResponse,
    start: number,
  ): Promise<Signal> {
    for (let index = start; index < response.toolCalls.length; index += 1) {
      const current = this.deps.coordinator.getAttempt(attempt.id);
      if (current.liveEpoch !== current.epoch) {
        return { type: "terminal", result: await this.finish(current.id, "fenced", "epoch", true) };
      }
      const boundary = this.boundary(current);
      if (boundary) {
        const cursor = this.responseCursor(response, index);
        this.writeCursor(current, [cursor]);
        return {
          type: "terminal",
          result: await this.finish(current.id, boundary.outcome, boundary.reason, false),
        };
      }
      if (this.deps.coordinator.turns(current.id).length >= maxStepsFor(current.level, current.maxSteps)) {
        return { type: "terminal", result: await this.finish(current.id, "stuck", "max_steps", true) };
      }
      const original = response.toolCalls[index];
      if (!original) throw new Error(`missing tool call ${index}`);
      const name = canonicalToolName(original.name, current.profile.editFormat);
      const call: ToolCall = { ...original, name };
      const allowed = allowedTools(current.packet.tools, current.profile.editFormat);
      const targetPath = stringField(call.arguments, "path") ?? stringField(call.arguments, "file");
      const unlockedReplaceLines =
        name === "replace_lines" &&
        targetPath !== null &&
        this.deps.edits.availableTools(targetPath).includes("replace_lines");
      if (call.malformed || (!allowed.includes(name) && !unlockedReplaceLines)) {
        return this.rejectTool(current, response, call, allowed, index);
      }
      if (isEditTool(name) && current.additiveSteer && !current.additiveSteer.acknowledged) {
        if (acknowledgesSteer(response.text, current.additiveSteer.id)) {
          this.deps.coordinator.updateAttempt(current.id, {
            additiveSteer: { ...current.additiveSteer, acknowledged: true },
          });
        } else {
          await this.commitStep(
            current,
            response,
            call,
            toolBody({
              ok: false,
              summary: `steer_ack_required: Acknowledge steer ${current.additiveSteer.id} before the next edit.`,
              output: current.additiveSteer.text,
            }),
            index,
            null,
          );
          return { type: "continue" };
        }
      }
      const site = this.site(current.id, index);
      this.writeCursor(current, [this.toolCursor("tool_in_flight", response, index, site.nextStep)]);
      if (this.shouldCrash("during_tool", site)) {
        this.deps.crash?.onCrash?.("during_tool", site);
        throw new CrashInjectedError("during_tool", site.nextStep, index);
      }
      let body: ToolBody;
      let preset: CheckpointCommit | null = null;
      try {
        if (name === "harness.submit_candidate") {
          preset = await this.prepareSubmit(current, site.nextStep);
          const changed = await this.deps.snapshots.changedPathsSinceBase();
          body = await this.deps.submit.submit({
            commitSha: preset.commitSha,
            changedPaths: changed,
          });
        } else if (name === "harness.flag_blocked") {
          body = await this.deps.flagBlocked.flag(stringField(call.arguments, "reason") ?? "");
        } else if (name === "harness.ask_owner") {
          body = await this.deps.askOwner.ask(
            stringField(call.arguments, "question") ?? "",
            stringField(call.arguments, "criterionId"),
          );
        } else if (name === "harness.dispute_test") {
          body = await this.deps.disputeTest.dispute(
            stringField(call.arguments, "checkId") ?? "",
            stringField(call.arguments, "counterexample") ?? "",
          );
        } else {
          body = await dispatchTool(
            {
              reader: this.deps.reader,
              edits: this.deps.edits,
              runner: this.deps.runner,
              readLog: this.deps.readLog,
              kb: this.deps.kb,
              notes: this.deps.notes,
              memory: current.workingMemory,
            },
            call,
          );
        }
      } catch (error) {
        if (error instanceof CrashInjectedError) throw error;
        if (isEditStuckError(error)) {
          await this.commitStep(
            current,
            response,
            call,
            toolBody({
              ok: false,
              summary: "edit_stuck: edit recovery ladder exhausted",
              output: error.message,
            }),
            index,
            null,
          );
          return { type: "terminal", result: await this.finish(current.id, "stuck", "edit_recovery", true) };
        }
        if (error instanceof Error) {
          body = toolBody({
            ok: false,
            summary: `error: ${error.name}`,
            output: error.message,
          });
        } else {
          throw error;
        }
      }
      this.writeCursor(current, [this.toolCursor("tool_done_unlogged", response, index, site.nextStep)]);
      if (this.shouldCrash("after_tool_before_log", site)) {
        this.deps.crash?.onCrash?.("after_tool_before_log", site);
        throw new CrashInjectedError("after_tool_before_log", site.nextStep, index);
      }
      const stuck = await this.commitStep(current, response, call, body, index, preset);
      if (body.terminal?.type === "submitted") {
        return { type: "terminal", result: await this.finish(current.id, "submitted", "submit_candidate", true) };
      }
      if (body.terminal?.type === "blocked") {
        this.deps.coordinator.updateAttempt(current.id, { routedTo: "AskOwner" });
        return {
          type: "terminal",
          result: await this.finish(current.id, "blocked", body.terminal.reason ?? "blocked", true),
        };
      }
      if (body.terminal?.type === "waiting_input" || body.terminal?.type === "disputed") {
        return {
          type: "terminal",
          result: await this.finish(current.id, "waiting_input", body.terminal.type, true),
        };
      }
      if (stuck) return { type: "terminal", result: await this.finish(current.id, "stuck", stuck, true) };
    }
    if (response.toolCalls.length === 0) {
      return this.consumeProse(this.deps.coordinator.getAttempt(attempt.id), response);
    }
    return { type: "continue" };
  }

  private async consumeProse(attempt: AttemptRecord, response: RecordedResponse): Promise<Signal> {
    const turns = this.deps.coordinator.turns(attempt.id);
    if (containsCodeFence(response.text)) {
      if (countPrefixed(turns, "prose_reminder:") >= 1) {
        await this.commitAssistant(attempt, response, "prose_repeated");
        return { type: "terminal", result: await this.finish(attempt.id, "stuck", "prose_only", true) };
      }
      await this.commitAssistant(
        attempt,
        response,
        "prose_reminder: Call the edit tool instead of writing code in prose.",
      );
      return { type: "continue" };
    }
    if (isPrematureDoneClaim(response.text)) {
      if (countPrefixed(turns, "done_reminder:") >= 1) {
        await this.commitAssistant(attempt, response, "done_repeated");
        return { type: "terminal", result: await this.finish(attempt.id, "stuck", "premature_done", true) };
      }
      await this.commitAssistant(
        attempt,
        response,
        "done_reminder: Call harness.submit_candidate, or call harness.flag_blocked stating what is missing.",
      );
      return { type: "continue" };
    }
    const summary = response.text.trim().slice(0, 180) || "assistant message";
    await this.commitAssistant(attempt, response, summary);
    return { type: "continue" };
  }

  private async rejectTool(
    attempt: AttemptRecord,
    response: RecordedResponse,
    call: ToolCall,
    allowed: readonly string[],
    index: number,
  ): Promise<Signal> {
    const prior = countPrefixed(this.deps.coordinator.turns(attempt.id), "malformed:");
    const reason = call.malformed
      ? (call.malformedError ?? "malformed tool arguments")
      : `unknown tool "${call.name}"`;
    if (prior >= 1) {
      await this.commitStep(
        attempt,
        response,
        call,
        toolBody({ ok: false, summary: `malformed: repeated ${reason}`, output: reason }),
        index,
        null,
        true,
      );
      return { type: "terminal", result: await this.finish(attempt.id, "stuck", "malformed_tool", true) };
    }
    const message = repairMessage(reason, allowed);
    await this.commitStep(
      attempt,
      response,
      call,
      toolBody({ ok: false, summary: `malformed: ${message}`, output: message }),
      index,
      null,
      true,
    );
    return { type: "continue" };
  }

  private async commitAssistant(
    attempt: AttemptRecord,
    response: RecordedResponse,
    summary: string,
  ): Promise<void> {
    await this.commitStep(
      attempt,
      response,
      null,
      toolBody({ ok: true, summary, output: summary }),
      0,
      null,
    );
  }

  private async commitStep(
    attempt: AttemptRecord,
    response: RecordedResponse,
    call: ToolCall | null,
    body: ToolBody,
    index: number,
    preset: CheckpointCommit | null,
    clearPending = false,
  ): Promise<string | null> {
    const current = this.deps.coordinator.getAttempt(attempt.id);
    const step = this.deps.coordinator.turns(current.id).length + 1;
    const snap =
      preset ??
      (await this.deps.snapshots.createCheckpointWipCommit({
        attemptId: current.id,
        step,
        taskId: current.task,
        previousWipRef: this.wip(current.id),
      }));
    const tree = await this.deps.snapshots.treeSha();
    const changed = await this.deps.snapshots.changedPathsSinceBase();
    const hasCheckRun = body.checkResults.length > 0 || body.failingCheckFingerprint !== null;
    const progress = nextProgress(
      {
        streak: current.progressStreak,
        tree: current.progressTree,
        fingerprint: current.progressFingerprint,
      },
      tree,
      body.failingCheckFingerprint,
      hasCheckRun,
    );
    const memory = body.memory ?? current.workingMemory;
    const checks = body.checkResults.length > 0 ? body.checkResults : current.lastCheckResults;
    const toolCall = call ? toolCallRecord(call.name, call.arguments) : null;
    const summary = body.summary;
    const repeatStuck =
      toolCall !== null &&
      !summary.startsWith("malformed:") &&
      !summary.startsWith("steer_ack_required:") &&
      !summary.startsWith("prose_") &&
      !summary.startsWith("done_") &&
      repeatWouldStick(this.deps.coordinator.turns(current.id), toolCall, summary);
    const note = generateHandoffNote({
      briefVersion: current.briefVersion,
      workingMemory: memory,
      changedFiles: changed,
      lastCheckResults: checks,
    });
    const more = !clearPending && index + 1 < response.toolCalls.length;
    const pending: PendingEffect[] = more ? [this.responseCursor(response, index + 1)] : [];
    this.deps.coordinator.transaction(() => {
      this.deps.coordinator.appendTurn({
        attempt: current.id,
        step,
        requestDigest: response.requestDigest,
        itemsArtifact: response.itemsArtifact,
        toolCall,
        resultSummary: summary,
        resultArtifact: body.artifactId,
        checkpointCommit: snap.wipRef,
        tokensIn: index === 0 ? response.tokensIn : 0,
        tokensOut: index === 0 ? response.tokensOut : 0,
      });
      this.deps.coordinator.saveCheckpoint({
        attempt: current.id,
        step,
        wipRef: snap.wipRef,
        sessionRef: null,
        contractVersions: { ...current.packet.contractVersions },
        pendingEffects: pending,
        handoffArtifact: note,
        updatedAt: this.deps.clock.now(),
      });
      this.deps.coordinator.updateAttempt(current.id, {
        workingMemory: memory,
        changedFiles: changed,
        lastCheckResults: checks,
        progressStreak: progress.streak,
        progressTree: progress.tree,
        progressFingerprint: progress.fingerprint,
      });
    });
    if (repeatStuck) return "repeat_tool";
    if (progress.stuck) return "no_progress";
    return null;
  }

  private async prepareSubmit(attempt: AttemptRecord, step: number): Promise<CheckpointCommit> {
    const changed = await this.deps.snapshots.changedPathsSinceBase();
    const inScope = changed.filter((file) => pathInScope(file, attempt.packet.writeScope));
    await this.deps.formatter.format(inScope);
    return this.deps.snapshots.createCheckpointWipCommit({
      attemptId: attempt.id,
      step,
      taskId: attempt.task,
      previousWipRef: this.wip(attempt.id),
    });
  }

  private async prepareContext(attempt: AttemptRecord, step: number): Promise<ContextBuildResult> {
    let current = attempt;
    if (current.briefChangedContradiction && !current.contradictionApplied) {
      this.deps.coordinator.updateAttempt(current.id, {
        contradictionApplied: true,
        historyFloorStep: this.deps.coordinator.turns(current.id).length,
      });
      current = this.deps.coordinator.getAttempt(current.id);
    }
    const history = this.history(current).filter((row) =>
      current.contradictionApplied ? row.step > current.historyFloorStep : true,
    );
    const fresh = current.contradictionApplied && history.length === 0;
    const wipRef = this.wip(current.id);
    const steer =
      current.additiveSteer && !current.additiveSteer.acknowledged
        ? `Steer ${current.additiveSteer.id}: ${current.additiveSteer.text}. Acknowledge this steer before the next edit.`
        : null;
    return this.deps.context.buildRequest({
      packet: current.packet,
      profile: current.profile,
      workingMemory: current.workingMemory,
      history,
      step,
      briefVersion: current.briefVersion,
      contradiction: fresh,
      wipDiff: current.contradictionApplied ? await this.deps.snapshots.diffFromRef(wipRef) : null,
      wipRef,
      steerNotice: steer,
      contextOverflow: current.overflowRetried,
    });
  }

  private history(attempt: AttemptRecord) {
    const seen = new Set<string>();
    return this.deps.coordinator.turns(attempt.id).map((turn) => {
      let items: ProviderItem[] = [];
      if (turn.itemsArtifact && !seen.has(turn.itemsArtifact)) {
        seen.add(turn.itemsArtifact);
        items = [...(this.deps.coordinator.items(turn.itemsArtifact) ?? [])];
      }
      return {
        step: turn.step,
        toolCall: turn.toolCall,
        resultSummary: turn.resultSummary,
        items,
      };
    });
  }

  private toRequest(attempt: AttemptRecord, built: BuiltContext, step: number): ModelTurnRequest {
    return {
      attemptId: attempt.id,
      step,
      store: false,
      model: attempt.model,
      requestDigest: built.requestDigest,
      body: built.body,
      replayItems: built.replayItems,
      tools: allowedTools(attempt.packet.tools, attempt.profile.editFormat),
      clientRequestId: `${attempt.id}:${built.requestDigest}`,
      idempotencyKey: `${attempt.id}:${built.requestDigest}`,
      briefVersion: built.briefVersion,
      rebuiltFromContradiction: built.rebuiltFromContradiction,
      zones: built.zones,
    };
  }

  private async resumeCursor(attempt: AttemptRecord, pending: PendingEffect): Promise<Signal> {
    if (pending.kind === "tool_in_flight" || pending.kind === "tool_done_unlogged") {
      await this.deps.snapshots.resetWorktreeToRef(this.wip(attempt.id));
      return this.executeTools(
        this.deps.coordinator.getAttempt(attempt.id),
        this.recordedFrom(pending),
        pending.toolIndex,
      );
    }
    if (pending.kind === "response_recorded") {
      return this.executeTools(attempt, this.recordedFrom(pending), pending.nextToolIndex);
    }
    this.writeCursor(attempt, []);
    return { type: "continue" };
  }

  private async reconcileUnknown(attemptId: string): Promise<void> {
    const unknown = await this.deps.budget.listUnknownReservations(attemptId);
    for (const reservationId of unknown) {
      await this.deps.budget.reconcileUnknownReservation(reservationId);
    }
  }

  private async finish(
    attemptId: string,
    outcome: TerminalOutcome,
    reason: string,
    clearPending: boolean,
  ): Promise<AttemptExecutionResult> {
    const attempt = this.deps.coordinator.getAttempt(attemptId);
    const existing = this.deps.coordinator.checkpoint(attemptId);
    const note = generateHandoffNote({
      briefVersion: attempt.briefVersion,
      workingMemory: attempt.workingMemory,
      changedFiles: attempt.changedFiles,
      lastCheckResults: attempt.lastCheckResults,
    });
    const state: AttemptRunState =
      outcome === "submitted" ? "submitted" : outcome === "fenced" ? "fenced" : "parked";
    this.deps.coordinator.saveCheckpoint({
      attempt: attemptId,
      step: existing?.step ?? 0,
      wipRef: existing?.wipRef ?? null,
      sessionRef: null,
      contractVersions: { ...attempt.packet.contractVersions },
      pendingEffects: clearPending ? [] : (existing?.pendingEffects ?? []),
      handoffArtifact: note,
      updatedAt: this.deps.clock.now(),
    });
    this.deps.coordinator.updateAttempt(attemptId, {
      state,
      outcome,
      endedAt: this.deps.clock.now(),
    });
    return {
      attemptId,
      outcome,
      state,
      reason,
      step: existing?.step ?? 0,
      wipRef: existing?.wipRef ?? null,
      handoffArtifact: note,
      countsAsFailedAttempt: outcome === "stuck",
      countsAsWorkerFailure: outcome === "stuck",
      settledUnits: await this.deps.budget.getSpentUnits(attemptId),
      changedFiles: [...attempt.changedFiles],
      routedTo: attempt.routedTo,
      checkpointRef: existing?.wipRef ?? null,
    };
  }

  private boundary(
    attempt: AttemptRecord,
  ): { outcome: TerminalOutcome; reason: string } | null {
    if (this.stop.has(attempt.id)) {
      this.stop.delete(attempt.id);
      return { outcome: "parked", reason: "stop" };
    }
    if (attempt.hardSteer) return { outcome: "parked", reason: "hard_steer" };
    const hold = attempt.holds[0];
    if (hold) return { outcome: "parked", reason: `hold:${hold.reason}` };
    if (this.pause.has(attempt.id)) {
      this.pause.delete(attempt.id);
      return { outcome: "parked", reason: "user_pause" };
    }
    return null;
  }

  private writeCursor(attempt: AttemptRecord, pending: PendingEffect[]): void {
    const existing = this.deps.coordinator.checkpoint(attempt.id);
    this.deps.coordinator.saveCheckpoint({
      attempt: attempt.id,
      step: existing?.step ?? this.deps.coordinator.turns(attempt.id).length,
      wipRef: existing?.wipRef ?? null,
      sessionRef: null,
      contractVersions: { ...attempt.packet.contractVersions },
      pendingEffects: pending,
      handoffArtifact: existing?.handoffArtifact ?? null,
      updatedAt: this.deps.clock.now(),
    });
  }

  private cursor(attemptId: string): PendingEffect | null {
    return this.deps.coordinator.checkpoint(attemptId)?.pendingEffects[0] ?? null;
  }

  private wip(attemptId: string): string | null {
    return this.deps.coordinator.checkpoint(attemptId)?.wipRef ?? null;
  }

  private site(attemptId: string, toolIndex: number | null): CrashSite {
    const completed = this.deps.coordinator.turns(attemptId).length;
    return { completedSteps: completed, nextStep: completed + 1, toolIndex };
  }

  private shouldCrash(point: CrashPoint, site: CrashSite): boolean {
    return this.deps.crash?.shouldCrash(point, site) ?? false;
  }

  private responseCursor(response: RecordedResponse, nextToolIndex: number): PendingEffect {
    return {
      kind: "response_recorded",
      itemsArtifact: response.itemsArtifact,
      requestDigest: response.requestDigest,
      toolCalls: response.toolCalls,
      nextToolIndex,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      text: response.text,
    };
  }

  private toolCursor(
    kind: "tool_in_flight" | "tool_done_unlogged",
    response: RecordedResponse,
    toolIndex: number,
    step: number,
  ): PendingEffect {
    return {
      kind,
      itemsArtifact: response.itemsArtifact,
      requestDigest: response.requestDigest,
      toolCalls: response.toolCalls,
      toolIndex,
      step,
      tokensIn: toolIndex === 0 ? response.tokensIn : 0,
      tokensOut: toolIndex === 0 ? response.tokensOut : 0,
      text: response.text,
    };
  }

  private recordedFrom(pending: PendingEffect): RecordedResponse {
    if (pending.kind === "model_in_flight") {
      throw new Error("model_in_flight has no recorded tool response");
    }
    return {
      itemsArtifact: pending.itemsArtifact,
      requestDigest: pending.requestDigest,
      toolCalls: pending.toolCalls,
      tokensIn: pending.tokensIn,
      tokensOut: pending.tokensOut,
      text: pending.text,
    };
  }

  private async settlePartial(reservationId: string, failure: TurnFailureView): Promise<void> {
    const actual = failure.partialTokensIn + failure.partialTokensOut;
    if (actual > 0) await this.deps.budget.settleReservation(reservationId, actual);
    else await this.deps.budget.releaseReservation(reservationId);
  }

  private async releaseIfHeld(reservationId: string): Promise<void> {
    await this.deps.budget.releaseReservation(reservationId);
  }

  private assertIntegerTokens(tokensIn: number, tokensOut: number): void {
    if (!Number.isSafeInteger(tokensIn) || tokensIn < 0 || !Number.isSafeInteger(tokensOut) || tokensOut < 0) {
      throw new Error("model token counts must be non-negative safe integers");
    }
  }
}
