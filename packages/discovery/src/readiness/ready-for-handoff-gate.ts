import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DenominatorDeltaExplainer } from "./denominator-delta-explainer.js";
import {
  appendOutbox,
  readFeatureState,
  readWorkItemStatus,
  setWorkItemStatus,
  withImmediateTransaction,
  writeNodeFields,
} from "./graph.js";
import { ReadinessCalculator } from "./readiness-calculator.js";
import { listFeatureIds } from "./sql.js";
import {
  canTransitionToReady,
  type FeatureReadinessState,
  type HandoffEvent,
  type HandoffTransition,
  type ReadinessPorts,
} from "./types.js";

function asFeatureState(value: string): FeatureReadinessState {
  if (value === "ready" || value === "not_applicable") return value;
  return "discovering";
}

export class ReadyForHandoffGate {
  private readonly calculator: ReadinessCalculator;

  constructor(
    private readonly db: DatabaseSync,
    private readonly explainer: DenominatorDeltaExplainer,
    private readonly ports: ReadinessPorts = {},
  ) {
    this.calculator = new ReadinessCalculator(db, ports);
  }

  transition(workItemId: string): HandoffTransition {
    return withImmediateTransaction(this.db, () => this.applyTransition(workItemId));
  }

  reopenAfterPremiseSupersession(input: {
    workItemId: string;
    decisionIds: readonly string[];
    reason: string;
    turnId: string;
  }): HandoffTransition {
    return withImmediateTransaction(this.db, () => {
      for (const decisionId of input.decisionIds) {
        writeNodeFields(this.db, this.ports, {
          nodeId: decisionId,
          summary: input.reason,
          patch: { status: "open" },
          removeKeys: ["basis"],
        });
      }
      this.explainer.writeReopen({
        workItemId: input.workItemId,
        turnId: input.turnId,
        reason: input.reason,
        reopenedDecisionIds: input.decisionIds,
      });
      return this.applyTransition(input.workItemId, input.reason);
    });
  }

  private applyTransition(workItemId: string, reopenReason?: string): HandoffTransition {
    this.explainer.assertExplained(workItemId);
    const project = this.calculator.project(workItemId);
    const features = listFeatureIds(this.db, workItemId);
    const events: HandoffEvent[] = [];
    let anyActive = false;
    let anyActiveReady = true;
    if (features.length === 0) {
      this.transitionSubject({
        workItemId,
        scopeId: workItemId,
        scopeKind: "work_item",
        allowed: canTransitionToReady(project),
        reopenReason,
        events,
      });
    } else {
      for (const featureId of features) {
        const report = this.calculator.scope(workItemId, featureId);
        if (report.disposition === "not_applicable") {
          this.setFeatureState(featureId, "not_applicable");
          continue;
        }
        if (report.disposition === "awaiting_definition") continue;
        anyActive = true;
        const allowed = canTransitionToReady(report);
        if (!allowed) anyActiveReady = false;
        this.transitionSubject({
          workItemId,
          scopeId: featureId,
          scopeKind: "feature",
          allowed,
          reopenReason,
          events,
        });
      }
      const projectAllowed = anyActive && anyActiveReady && canTransitionToReady(project);
      this.transitionSubject({
        workItemId,
        scopeId: workItemId,
        scopeKind: "work_item",
        allowed: projectAllowed,
        reopenReason,
        events,
      });
    }
    return {
      workItemStatus: readWorkItemStatus(this.db, workItemId),
      events,
      project: this.calculator.project(workItemId),
    };
  }

  private transitionSubject(input: {
    workItemId: string;
    scopeId: string;
    scopeKind: "work_item" | "feature";
    allowed: boolean;
    reopenReason: string | undefined;
    events: HandoffEvent[];
  }): void {
    const current = this.readState(input.scopeKind, input.workItemId, input.scopeId);
    if (input.allowed) {
      if (current === "ready") return;
      this.writeState(input.scopeKind, input.workItemId, input.scopeId, "ready");
      if (this.readState(input.scopeKind, input.workItemId, input.scopeId) !== "ready") return;
      input.events.push(
        this.emit({
          workItemId: input.workItemId,
          scopeId: input.scopeId,
          scopeKind: input.scopeKind,
          type: "discovery.scope_ready",
          from: current,
          to: "ready",
        }),
      );
      return;
    }
    if (current !== "ready") return;
    this.writeState(input.scopeKind, input.workItemId, input.scopeId, "discovering");
    input.events.push(
      this.emit({
        workItemId: input.workItemId,
        scopeId: input.scopeId,
        scopeKind: input.scopeKind,
        type: "discovery.scope_reopened",
        from: "ready",
        to: "discovering",
        reason: input.reopenReason ?? "readiness fell below the planning gate",
      }),
    );
  }

  private readState(
    scopeKind: "work_item" | "feature",
    workItemId: string,
    scopeId: string,
  ): FeatureReadinessState {
    const raw =
      scopeKind === "feature"
        ? readFeatureState(this.db, scopeId)
        : readWorkItemStatus(this.db, workItemId);
    return asFeatureState(raw);
  }

  private writeState(
    scopeKind: "work_item" | "feature",
    workItemId: string,
    scopeId: string,
    state: "ready" | "discovering",
  ): void {
    if (scopeKind === "work_item") {
      setWorkItemStatus(this.db, workItemId, state);
      return;
    }
    this.setFeatureState(scopeId, state);
  }

  private setFeatureState(featureId: string, state: FeatureReadinessState): void {
    if (readFeatureState(this.db, featureId) === state) return;
    writeNodeFields(this.db, this.ports, {
      nodeId: featureId,
      summary: `scope ${featureId} ${state}`,
      patch: { readinessState: state },
    });
  }

  private emit(input: {
    workItemId: string;
    scopeId: string;
    scopeKind: "work_item" | "feature";
    type: HandoffEvent["type"];
    from: HandoffEvent["payload"]["from"];
    to: HandoffEvent["payload"]["to"];
    reason?: string;
  }): HandoffEvent {
    const payload: HandoffEvent["payload"] = {
      workItemId: input.workItemId,
      scopeId: input.scopeId,
      scopeKind: input.scopeKind,
      from: input.from,
      to: input.to,
    };
    if (input.type === "discovery.scope_ready") payload.action = "Expand Spec & Plan";
    if (input.reason) payload.reason = input.reason;
    const event: HandoffEvent = {
      id: `${input.type}:${input.scopeId}:${randomUUID()}`,
      type: input.type,
      subject: input.scopeId,
      payload,
    };
    const rev = this.db.prepare("SELECT max(rev) AS rev FROM change_sets").get() as
      | { rev: number | null }
      | undefined;
    appendOutbox(this.db, { ...event, rev: rev?.rev ?? null });
    return event;
  }
}
