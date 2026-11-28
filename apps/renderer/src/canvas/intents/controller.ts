import { PostSendChangeHighlighter } from "../popovers/highlighter.js";
import type { CanvasNodeCatalog, CanvasViewportPort, MotionPreferencePort } from "../popovers/ports.js";
import type { ComposerTargetStateMachine } from "../../composer/composer-target-state-machine.js";
import type { CanvasDaemonDispatch } from "../graph/daemon-persistence.js";
import { formatPair, misheardPair, projectWording } from "./classify.js";
import { RevisionDriftConflictPrompt, type DriftView } from "./drift.js";
import type { IntentGraph } from "./graph.js";
import {
  classifyChange,
  exceedsAutoStart,
  needsConfirmation,
  previewTotals,
  reviewCutoff,
  reverifyMerged,
  walkCombined,
} from "./impact.js";
import { ZeroTokenImpactPreviewModal } from "./modal.js";
import { availableIntents, isBuiltFeature, isPreBuildSpec, presetMode, smartIntent } from "./selection.js";
import { CorrectVsChangeTogglePreset } from "./toggle.js";
import {
  ASK_OWNER_RESPONDER_ID,
  MICRO_USD_PER_DELTA_TASK,
  UNDO_TOAST_LABEL,
  type BoxChatIntent,
  type BoxRecord,
  type ChangeClass,
  type ChildKind,
  type DriftChoice,
  type FeatureUndoLaunch,
  type ImpactedSubgraph,
  type MisheardPair,
  type ModelPort,
  type NetworkPort,
  type RemovalDisposition,
  type UndoToast,
  type BoxChatSubmission,
} from "./types.js";

interface Lock {
  readonly nodeId: string;
  readonly baseRevision: number;
  readonly baseValue: string;
}

interface PendingEdit {
  readonly id: string;
  readonly intent: "correct" | "change" | "remove_defer";
  readonly nodeIds: readonly string[];
  readonly draft: string;
  readonly disposition: RemovalDisposition;
  readonly changeClass: ChangeClass;
  readonly cursor: number;
}

interface UndoEntry {
  readonly nodes: readonly { readonly id: string; readonly version: number }[];
}

export class BoxChatIntentController {
  readonly highlighter: { readonly highlighted: string[][] };
  private readonly postSend: PostSendChangeHighlighter;
  lastResult: object | null = null;
  private draft = "";
  private cursor = 0;
  private focused = false;
  private readonly locks = new Map<string, Lock>();
  private readonly pending = new Map<string, PendingEdit>();
  private sequence = 0;
  private childSequence = 0;
  private undoEntry: UndoEntry | null = null;
  private readonly highlighted: string[][] = [];

  constructor(
    readonly graph: IntentGraph,
    private readonly model: ModelPort | null,
    private readonly network: NetworkPort | null,
    private readonly composerMachine: ComposerTargetStateMachine | null = null,
    private readonly dispatch: CanvasDaemonDispatch | null = null,
  ) {
    this.highlighter = { highlighted: this.highlighted };
    this.postSend = new PostSendChangeHighlighter(
      { now: () => Date.now() },
      quietViewport,
      quietCatalog,
      quietMotion,
    );
  }

  get composer(): { readonly draft: string; readonly cursor: number; readonly focused: boolean } {
    if (this.composerMachine) {
      const caret = this.composerMachine.projection().caret;
      return { draft: caret.text, cursor: caret.cursor, focused: this.focused };
    }
    return { draft: this.draft, cursor: this.cursor, focused: this.focused };
  }

  beginComposer(nodeIds: readonly string[], draft = "", cursor = 0): void {
    this.locks.clear();
    for (const nodeId of nodeIds) {
      const box = this.graph.requireBox(nodeId);
      this.locks.set(nodeId, { nodeId, baseRevision: box.version, baseValue: box.value || box.text });
    }
    this.writeDraft(draft, cursor);
    this.focused = true;
    this.captureFocus(nodeIds);
  }

  setDraft(draft: string, cursor: number): void {
    this.writeDraft(draft, cursor);
    this.focused = true;
  }

  smartDefault(nodeIds: readonly string[]): {
    readonly highlighted: BoxChatIntent;
    readonly available: readonly BoxChatIntent[];
    readonly lockedOut: readonly BoxChatIntent[];
  } {
    const boxes = nodeIds.map((id) => this.graph.requireBox(id));
    return { highlighted: smartIntent(boxes), available: availableIntents(boxes), lockedOut: [] };
  }

  presetFor(nodeIds: readonly string[]): CorrectVsChangeTogglePreset {
    const boxes = nodeIds.map((id) => this.graph.requireBox(id));
    return new CorrectVsChangeTogglePreset(presetMode(boxes));
  }

  submit(input: BoxChatSubmission): object {
    const boxes = input.nodeIds.map((id) => this.graph.requireBox(id));
    if (input.draft !== undefined) this.writeDraft(input.draft, input.cursor ?? this.cursor);
    else if (input.cursor !== undefined) this.writeDraft(this.draft, input.cursor);
    const draft = this.composer.draft;
    if (input.intent === "ask") return this.remember(this.answer(boxes, draft));
    if (input.intent === "explain_impact") return this.remember(this.explain(boxes, input));
    if (input.intent === "resolve_conflict" || input.intent === "approve_edit") {
      return this.remember({
        kind: "intent_selected",
        intent: input.intent,
        routedTo: [],
        mutations: this.graph.mutationCount,
        holds: this.graph.holdCount(),
      });
    }
    if (input.intent === "add") return this.remember(this.addChild(boxes, draft, input.childKind ?? "requirement"));
    const intent = input.intent;
    const disposition = input.disposition ?? "defer";
    if (intent === "remove_defer" && boxes.some((box) => isBuiltFeature(box))) {
      const feature = boxes.find((box) => isBuiltFeature(box));
      if (!feature) throw new Error("missing built feature");
      return this.remember(this.launchUndo(feature));
    }
    const drift = this.findDrift(input.nodeIds, draft);
    if (drift) return this.remember(this.openDrift(drift, intent, disposition));
    return this.remember(this.routeEdit(intent, input.nodeIds, draft, disposition, false));
  }

  applyPreview(id: string): object {
    const pending = this.pending.get(id);
    if (!pending) throw new Error(`Unknown impact preview ${id}`);
    const drift = this.findDrift(pending.nodeIds, pending.draft);
    if (drift) {
      this.pending.delete(id);
      return this.remember(this.openDrift(drift, pending.intent, pending.disposition));
    }
    this.pending.delete(id);
    return this.remember(this.routeEdit(pending.intent, pending.nodeIds, pending.draft, pending.disposition, true));
  }

  editInstruction(id: string): object {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    this.focused = true;
    this.writeDraft(this.draft, this.draft.length);
    return this.remember(this.sideEffectFree("edit_instruction", pending?.cursor ?? this.cursor));
  }

  cancelPreview(id: string): object {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    this.focused = true;
    this.writeDraft(this.draft, pending?.cursor ?? this.cursor);
    return this.remember({
      kind: "cancelled",
      mutations: this.graph.mutationCount,
      holds: this.graph.holdCount(),
      llmCalls: 0 as const,
      networkCalls: this.network?.calls ?? 0,
      modelCalls: this.model?.calls ?? 0,
      tokensSpent: 0 as const,
      cursor: this.cursor,
      focused: true as const,
      draft: this.draft,
    });
  }

  chooseDrift(id: string, choice: DriftChoice): object {
    const entry = this.drifts.get(id);
    if (!entry) throw new Error(`Unknown revision drift ${id}`);
    entry.prompt.choose(choice);
    this.drifts.delete(id);
    return this.remember(
      this.settleDrift(choice, entry.prompt.view, entry.intent, entry.disposition, entry.nodeIds, entry.draft),
    );
  }

  undoLast(): object {
    const entry = this.undoEntry;
    this.undoEntry = null;
    if (!entry) {
      return { kind: "nothing_to_undo", routedTo: [], mutations: this.graph.mutationCount };
    }
    for (const node of entry.nodes) this.graph.restoreVersion(node.id, node.version);
    this.focused = true;
    return {
      kind: "undone",
      routedTo: ["task-017"],
      label: UNDO_TOAST_LABEL,
      mutations: this.graph.mutationCount,
      nodeId: entry.nodes[0]?.id ?? "",
    };
  }

  private readonly drifts = new Map<string, {
    readonly prompt: RevisionDriftConflictPrompt;
    readonly nodeId: string;
    readonly nodeIds: readonly string[];
    readonly draft: string;
    readonly intent: "correct" | "change" | "remove_defer";
    readonly disposition: RemovalDisposition;
  }>();

  private remember<T extends object>(result: T): T {
    this.lastResult = result;
    return result;
  }

  private answer(boxes: readonly BoxRecord[], question: string): object {
    const before = this.graph.mutationCount;
    const impact = walkCombined(this.graph, boxes.map((box) => box.id));
    const titles = [...impact.affectedActiveTasks, ...impact.affectedMergedTasks].map((id) => this.graph.taskTitle(id));
    const text = answerFromBoxes(boxes, question, titles);
    this.notify("canvas.intent.ask", { question, nodeIds: boxes.map((box) => box.id), text });
    return {
      kind: "answer",
      routedTo: ["task-102"],
      responderId: ASK_OWNER_RESPONDER_ID,
      text,
      mutations: this.graph.mutationCount,
      mutationDelta: this.graph.mutationCount - before,
      holds: this.graph.holdCount(),
      llmCalls: 0 as const,
      networkCalls: this.network?.calls ?? 0,
      modelCalls: this.model?.calls ?? 0,
    };
  }

  private explain(boxes: readonly BoxRecord[], input: BoxChatSubmission): object {
    const before = this.graph.mutationCount;
    const impact = this.walk(boxes.map((box) => box.id));
    return {
      kind: "explain_impact",
      routedTo: ["task-087"],
      impact,
      highlightedNodeIds: impact.nodes.map((node) => node.id),
      llmCalls: 0 as const,
      networkCalls: this.network?.calls ?? 0,
      modelCalls: this.model?.calls ?? 0,
      elapsedMs: impact.elapsedMs,
      mutations: this.graph.mutationCount,
      mutationDelta: this.graph.mutationCount - before,
      holds: this.graph.holdCount(),
      offline: input.offline === true,
      apiBudgetRemaining: input.apiBudgetRemaining ?? null,
      canonicalQueries: impact.canonicalQueries,
      cycleSafeQueries: impact.cycleSafeQueries,
    };
  }

  private addChild(boxes: readonly BoxRecord[], draft: string, childKind: ChildKind): object {
    const parent = boxes[0];
    if (!parent) throw new Error("Add needs a parent box");
    this.childSequence += 1;
    const childId = `child-${parent.id}-${this.childSequence}`;
    const title = draft.trim() || `New ${childKind}`;
    this.graph.addChild({ childId, parentId: parent.id, kind: childKind, title, text: title });
    const edges = this.graph.currentEdges(childId);
    return {
      kind: "applied",
      intent: "add" as const,
      routedTo: ["task-087"],
      changeClass: "compatible" as const,
      historyLabel: "added child",
      holdsPlaced: [],
      restarts: [],
      cleanedDerivedIds: [],
      corrections: [],
      postSendHighlightIds: [],
      undoToast: null,
      childId,
      parentEdges: edges.filter((edge) => edge.src === childId),
      llmCalls: 0 as const,
      networkCalls: this.network?.calls ?? 0,
      modelCalls: this.model?.calls ?? 0,
      mutations: this.graph.mutationCount,
    };
  }

  private launchUndo(box: BoxRecord): object {
    const before = this.graph.mutationCount;
    const inventory = featureInventory(box);
    return {
      kind: "feature_undo",
      routedTo: ["task-129"],
      inventory,
      deleted: false as const,
      mutations: this.graph.mutationCount,
      mutationDelta: this.graph.mutationCount - before,
      holds: this.graph.holdCount(),
      llmCalls: 0 as const,
      llmTokens: 0 as const,
    };
  }

  private routeEdit(
    intent: "correct" | "change" | "remove_defer",
    nodeIds: readonly string[],
    draft: string,
    disposition: RemovalDisposition,
    force: boolean,
  ): object {
    if (!force) {
      const drift = this.findDrift(nodeIds, draft);
      if (drift) return this.openDrift(drift, intent, disposition);
    }
    const boxes = nodeIds.map((id) => this.graph.requireBox(id));
    const changeClass = intent === "remove_defer" ? "breaking" : this.classifyBoxes(boxes, draft);
    const impact = this.walk(nodeIds);
    const routes = ["task-087", "task-108"];
    const deltaTasks = changeClass === "breaking" ? impact.affectedMergedTasks.length : 0;
    const deltaCost = deltaTasks * MICRO_USD_PER_DELTA_TASK;
    const needsOwner = exceedsAutoStart({
      deltaTasks,
      deltaCostMicroUsd: deltaCost,
      breaking: intent !== "remove_defer" && changeClass === "breaking",
    });
    this.notify("canvas.intent.autoStart", { deltaTasks, deltaCostMicroUsd: deltaCost, needsOwner });
    const confirm = !force && needsConfirmation({
      intent,
      changeClass,
      active: impact.affectedActiveTasks.length,
      merged: impact.affectedMergedTasks.length,
      deltaTasks,
      deltaCostMicroUsd: deltaCost,
    });
    if (confirm) return this.openPreview({ id: this.nextId("preview"), intent, nodeIds, draft, disposition, changeClass, cursor: this.cursor }, impact, routes);
    return this.commit({ intent, nodeIds, draft, disposition, changeClass, active: impact.affectedActiveTasks, merged: impact.affectedMergedTasks, routes });
  }

  private openPreview(pending: PendingEdit, impact: ImpactedSubgraph, routes: string[]): object {
    this.pending.set(pending.id, pending);
    this.focused = false;
    const totals = previewTotals(this.graph, impact, pending.changeClass);
    const modal = new ZeroTokenImpactPreviewModal(pending.id, totals, {
      apply: () => {
        this.lastResult = this.applyPreview(pending.id);
      },
      edit: () => {
        this.lastResult = this.editInstruction(pending.id);
      },
      cancel: () => {
        this.lastResult = this.cancelPreview(pending.id);
      },
    });
    return {
      kind: "impact_preview",
      modal,
      routedTo: routes,
      mutations: this.graph.mutationCount,
      holds: this.graph.holdCount(),
      llmCalls: 0 as const,
      networkCalls: this.network?.calls ?? 0,
      modelCalls: this.model?.calls ?? 0,
      elapsedMs: impact.elapsedMs,
    };
  }

  private commit(input: {
    readonly intent: "correct" | "change" | "remove_defer";
    readonly nodeIds: readonly string[];
    readonly draft: string;
    readonly disposition: RemovalDisposition;
    readonly changeClass: ChangeClass;
    readonly active: readonly string[];
    readonly merged: readonly string[];
    readonly routes: string[];
  }): object {
    const snapshots = input.nodeIds.map((id) => {
      const box = this.graph.requireBox(id);
      return { id, version: box.version, value: box.value, text: box.text, preBuild: isPreBuildSpec(box) };
    });
    const corrections: MisheardPair[] = [];
    const cleaned: string[] = [];
    if (input.intent === "remove_defer") {
      const status = input.disposition === "deprecate" ? "deprecated" : "deferred";
      for (const snap of snapshots) {
        this.graph.writeStatus(snap.id, status, input.disposition === "deprecate" ? "deprecated" : "deferred");
      }
      input.routes.push("task-074");
    } else {
      const historyLabel = input.intent === "correct" ? "corrected transcription" : "changed mind";
      for (const snap of snapshots) {
        const next = projectWording(snap.text, snap.value, input.draft);
        this.graph.writeWording(snap.id, { ...next, historyLabel });
        if (input.intent === "correct") {
          const heard = misheardPair(`${snap.text} ${snap.value}`, `${next.text} ${next.value}`);
          if (heard) {
            const pair = { heard: heard.heard, intended: heard.intended, pair: formatPair(heard.heard, heard.intended) };
            this.graph.recordCorrection(pair);
            this.notify("canvas.intent.vocabulary", { ...pair });
            corrections.push(pair);
            input.routes.push("task-158");
          }
          if (input.changeClass !== "cosmetic") {
            const falseValue = snap.value || heard?.heard || "";
            cleaned.push(...this.graph.cleanupFalseDerivations(snap.id, falseValue));
            this.notify("canvas.intent.reopen", { premiseId: snap.id, falseValue });
            input.routes.push("task-071");
          }
        }
      }
    }
    const holdsPlaced: string[] = [];
    const restarts: string[] = [];
    if (input.changeClass !== "cosmetic") {
      if (input.active.length > 0) {
        this.graph.placeHolds(input.active);
        holdsPlaced.push(...input.active);
      }
      if (input.merged.length > 0) {
        const checked = reverifyMerged(input.merged);
        restarts.push(...checked.rework);
      }
    } else {
      this.noteHighlight(input.nodeIds);
      input.routes.push("task-154");
    }
    const toast = snapshots.every((snap) => snap.preBuild);
    const undoToast: UndoToast | null = toast
      ? { label: UNDO_TOAST_LABEL, available: true, nodeId: snapshots[0]?.id ?? "" }
      : null;
    if (toast) this.undoEntry = { nodes: snapshots.map((snap) => ({ id: snap.id, version: snap.version })) };
    if (input.intent === "remove_defer") {
      const impact = this.walk(input.nodeIds);
      return {
        kind: "removed",
        routedTo: input.routes,
        disposition: input.disposition,
        dependencyIds: impact.nodes.map((node) => node.id),
        status: input.disposition === "deprecate" ? "deprecated" : "deferred",
        undoToast,
        holdsPlaced,
        restarts,
        llmCalls: 0 as const,
        networkCalls: this.network?.calls ?? 0,
        modelCalls: this.model?.calls ?? 0,
        mutations: this.graph.mutationCount,
      };
    }
    return {
      kind: "applied",
      intent: input.intent,
      routedTo: input.routes,
      changeClass: input.changeClass,
      historyLabel: input.intent === "correct" ? "corrected transcription" : "changed mind",
      holdsPlaced,
      restarts,
      cleanedDerivedIds: cleaned,
      corrections,
      postSendHighlightIds: input.changeClass === "cosmetic" ? [...input.nodeIds] : [],
      undoToast,
      childId: null,
      llmCalls: 0 as const,
      networkCalls: this.network?.calls ?? 0,
      modelCalls: this.model?.calls ?? 0,
      mutations: this.graph.mutationCount,
    };
  }

  private findDrift(nodeIds: readonly string[], draft: string): DriftView | null {
    for (const nodeId of nodeIds) {
      const lock = this.locks.get(nodeId);
      if (!lock) continue;
      const box = this.graph.requireBox(nodeId);
      if (lock.baseRevision === box.version) continue;
      const prior = this.graph.versionRow(nodeId, lock.baseRevision);
      return {
        nodeId,
        title: box.title,
        baseRevision: lock.baseRevision,
        currentDbRevision: box.version,
        baseValue: prior?.value || lock.baseValue,
        currentValue: box.value,
        draftValue: draft,
        source: box.revisionSource || "another edit",
      };
    }
    return null;
  }

  private openDrift(
    view: DriftView,
    intent: "correct" | "change" | "remove_defer",
    disposition: RemovalDisposition,
  ): object {
    const id = this.nextId("drift");
    const prompt = new RevisionDriftConflictPrompt(id, view, () => undefined);
    this.drifts.set(id, { prompt, nodeId: view.nodeId, nodeIds: [view.nodeId], draft: view.draftValue, intent, disposition });
    return {
      kind: "revision_drift",
      prompt,
      routedTo: ["task-155", "task-087"],
      mutations: this.graph.mutationCount,
      holds: this.graph.holdCount(),
      llmCalls: 0 as const,
      networkCalls: this.network?.calls ?? 0,
      modelCalls: this.model?.calls ?? 0,
      applied: false as const,
    };
  }

  private classifyBoxes(boxes: readonly BoxRecord[], draft: string): ChangeClass {
    let best: ChangeClass = "cosmetic";
    const rank: Record<ChangeClass, number> = { cosmetic: 0, clarifying: 1, compatible: 2, breaking: 3 };
    for (const box of boxes) {
      const next = projectWording(box.text, box.value, draft);
      const change = classifyChange(`${box.text}\n${box.value}`, `${next.text}\n${next.value}`);
      if (rank[change] > rank[best]) best = change;
    }
    return best;
  }

  private walk(nodeIds: readonly string[]): ImpactedSubgraph {
    const impact = walkCombined(this.graph, nodeIds);
    reviewCutoff(impact.nodes.map((node) => node.id));
    return impact;
  }

  private settleDrift(
    choice: DriftChoice,
    view: DriftView,
    intent: "correct" | "change" | "remove_defer",
    disposition: RemovalDisposition,
    nodeIds: readonly string[],
    draft: string,
  ): object {
    if (choice === "edit_again") {
      this.focused = true;
      this.writeDraft(draft, draft.length);
      return {
        ...this.sideEffectFree("edit_again", this.cursor),
        driftNodeId: view.nodeId,
        applied: false as const,
      };
    }
    if (choice === "keep_current") {
      this.focused = true;
      this.writeDraft(this.draft, this.draft.length);
      return {
        kind: "kept_current",
        driftNodeId: view.nodeId,
        currentValue: view.currentValue,
        routedTo: ["task-155"],
        mutations: this.graph.mutationCount,
        holds: this.graph.holdCount(),
        llmCalls: 0 as const,
        applied: false as const,
      };
    }
    return this.routeEdit(intent, nodeIds.length > 0 ? nodeIds : [view.nodeId], draft, disposition, true);
  }

  private sideEffectFree(kind: string, cursor: number): object {
    return {
      kind,
      mutations: this.graph.mutationCount,
      holds: this.graph.holdCount(),
      llmCalls: 0 as const,
      networkCalls: this.network?.calls ?? 0,
      modelCalls: this.model?.calls ?? 0,
      tokensSpent: 0 as const,
      cursor,
      focused: true as const,
      draft: this.draft,
    };
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  private writeDraft(draft: string, cursor: number): void {
    this.draft = draft;
    this.cursor = cursor;
    this.composerMachine?.replaceDraft(draft, cursor);
  }

  private noteHighlight(ids: readonly string[]): void {
    const copy = [...ids];
    this.highlighted.push(copy);
    this.postSend.commit({ added: [], updated: copy, impacted: [], removed: [] });
    this.notify("canvas.intent.highlight", { nodeIds: copy });
  }

  private captureFocus(nodeIds: readonly string[]): void {
    this.notify("composer.focus.begin", {
      draftId: "single-composer",
      inputStartedAt: new Date(0).toISOString(),
      activeTab: "canvas",
      selectedCanvasNodeIds: [...nodeIds],
      openQuestionCardId: null,
      openQuestionOptionsVersion: null,
      focusedFeatureId: nodeIds[0] ?? null,
      inspectedTaskId: null,
      previewSelectedElement: null,
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.dispatch) return;
    this.dispatch(method, params);
  }
}

export function createBoxChatIntentController(options: {
  readonly graph: IntentGraph;
  readonly model?: ModelPort;
  readonly network?: NetworkPort;
  readonly composer?: ComposerTargetStateMachine;
  readonly dispatch?: CanvasDaemonDispatch;
}): BoxChatIntentController {
  return new BoxChatIntentController(
    options.graph,
    options.model ?? null,
    options.network ?? null,
    options.composer ?? null,
    options.dispatch ?? null,
  );
}

function answerFromBoxes(boxes: readonly BoxRecord[], question: string, dependentTitles: readonly string[]): string {
  const body = boxes.map((box) => {
    const parts = [
      box.provenanceQuote ? `Provenance: ${box.provenanceQuote}` : "",
      box.text ? `Why: ${box.text}` : "",
      box.codeStatus ? `Code status: ${box.codeStatus}` : "",
    ].filter((part) => part.length > 0);
    return parts.join(" ");
  });
  const dependents = dependentTitles.length > 0
    ? `Dependent tasks: ${dependentTitles.join(", ")}`
    : "Dependent tasks: none";
  return [`${ASK_OWNER_RESPONDER_ID}`, question, ...body, dependents].filter((line) => line.length > 0).join("\n");
}

const quietCatalog: CanvasNodeCatalog = {
  get: () => null,
  list: () => [],
  archive: () => undefined,
  label: (id) => id,
};

const quietViewport: CanvasViewportPort = {
  viewport: () => ({ x: 0, y: 0, width: 1, height: 1 }),
  setViewport: () => undefined,
  panZoomTo: (nodeId) => ({ nodeId, x: 0, y: 0, zoom: 1 }),
  focusConnected: () => [],
  isOffscreen: () => false,
  setOffscreen: () => undefined,
  setEdges: () => undefined,
  lastPan: () => null,
  neighborhood: () => [],
};

const quietMotion: MotionPreferencePort = {
  prefersReducedMotion: () => false,
  setPrefersReducedMotion: () => undefined,
};

function featureInventory(box: BoxRecord): FeatureUndoLaunch {
  const shared = stringList(box.fields, "sharedHelpers");
  const tables = stringList(box.fields, "dormantTables");
  const exclusive = stringList(box.fields, "exclusiveFiles");
  const plain = [
    `Undo ${box.id} ${box.title}`.trim(),
    `Shared helpers: ${shared.length > 0 ? shared.join(", ") : "none"}`,
    tables.length > 0 ? `Data ${tables.join(", ")}` : "Data no database tables or columns",
    "Keep schema/data dormant (Safe default — expand-then-contract)",
    "Drop table/column in new additive-safe down-migration",
  ].join("\n");
  return {
    featureId: box.id,
    title: box.title,
    deleted: false,
    llmTokens: 0,
    sharedHelpers: shared,
    dormantTables: tables,
    exclusiveFiles: exclusive,
    dataChoiceDefault: "keep_dormant",
    dataOptions: ["keep_dormant", "drop_in_new_migration"],
    plainEnglish: plain,
    steps: [
      {
        step: 1,
        name: "inventory",
        executed: true,
        detail: `Inventory shared helpers (${shared.join(", ") || "none"}) and dormant tables (${tables.join(", ") || "none"}).`,
      },
      { step: 2, name: "preview", executed: true, detail: plain },
      {
        step: 3,
        name: "confirm_execution",
        executed: false,
        detail: "Waiting for explicit confirmation. No nodes were deleted.",
      },
    ],
  };
}

function stringList(fields: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = fields[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
