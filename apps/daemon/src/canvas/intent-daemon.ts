import { ProjectDictationVocabularyManager } from "@ef-harness/dictation";
import { RevisionAutoStartPolicy } from "@ef-harness/planner";
import { CanonicalStateDb } from "./canonical-state-db.js";
import type { NodeDraft, OutlineSnapshot, ReadinessCounts } from "./tab-records.js";

const CANVAS_PROJECT = "canvas";

export class CanvasIntentDaemon {
  readonly tabs: CanonicalStateDb;
  readonly vocabulary = new ProjectDictationVocabularyManager();
  readonly autoStart = new RevisionAutoStartPolicy();
  private correctionSeq = 0;
  private closed = false;

  constructor() {
    this.tabs = new CanonicalStateDb();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.tabs.close();
  }

  ask(params: Record<string, unknown>): { readonly responderId: string; readonly text: string } {
    const text = typeof params.text === "string" ? params.text : "";
    return { responderId: "ask-owner-responder@1", text };
  }

  impact(params: Record<string, unknown>): { readonly nodes: readonly { readonly id: string; readonly depth: number }[] } {
    const startId = typeof params.startId === "string" ? params.startId : "";
    const maxDepth = typeof params.maxDepth === "number" ? params.maxDepth : 64;
    return { nodes: this.tabs.impactWalk(startId, maxDepth) };
  }

  vocabularyPair(params: Record<string, unknown>): { readonly promoted: boolean; readonly occurrenceCount: number } {
    const heard = typeof params.heard === "string" ? params.heard : "";
    const intended = typeof params.intended === "string" ? params.intended : "";
    this.correctionSeq += 1;
    const observed = this.vocabulary.learner.observeCorrection({
      projectId: CANVAS_PROJECT,
      heard,
      corrected: intended,
      occurrenceId: `canvas-${this.correctionSeq}`,
    });
    return { promoted: observed.promoted, occurrenceCount: observed.occurrence_count };
  }

  autoStartDecision(params: Record<string, unknown>): { readonly autoStart: boolean; readonly needsOwner: boolean } {
    const deltaTasks = typeof params.deltaTasks === "number" ? params.deltaTasks : 0;
    const deltaCost = typeof params.deltaCostMicroUsd === "number" ? params.deltaCostMicroUsd : 0;
    const decision = this.autoStart.evaluate({
      revisionId: "canvas-box-chat",
      isFirstBuild: false,
      connection: "subscription",
      deltaTasks,
      deltaCostMicroUsd: BigInt(Math.max(0, Math.trunc(deltaCost))),
      deltaPlanWindowPpm: 0,
      planWindowPpm: 1_000_000,
      nowMs: Date.now(),
      unresolvedMustAsk: false,
      unresolvedConflict: false,
      breakingContract: params.needsOwner === true && deltaTasks > 5,
      destructiveMigration: null,
      newPackages: [],
      externalEffects: [],
    });
    return { autoStart: decision.autoStart, needsOwner: decision.autoStart === false };
  }

  readOutline(): OutlineSnapshot {
    return this.tabs.readOutline();
  }

  readiness(): ReadinessCounts {
    return this.tabs.readiness();
  }

  insertNodes(params: Record<string, unknown>): { readonly inserted: number } {
    const nodes = Array.isArray(params.nodes) ? params.nodes.flatMap(readDraft) : [];
    if (nodes.length > 0) this.tabs.insertNodes(nodes);
    return { inserted: nodes.length };
  }

  linkEdge(params: Record<string, unknown>): { readonly linked: boolean } {
    const src = typeof params.src === "string" ? params.src : "";
    const type = typeof params.type === "string" ? params.type : "";
    const dst = typeof params.dst === "string" ? params.dst : "";
    if (!src || !type || !dst) return { linked: false };
    this.tabs.linkEdge(src, type, dst);
    return { linked: true };
  }
}

function readDraft(value: unknown): NodeDraft[] {
  if (!isRecord(value)) return [];
  const id = value.id;
  const kind = value.kind;
  const title = value.title;
  if (typeof id !== "string" || typeof title !== "string" || !isNodeKind(kind)) return [];
  const draft: NodeDraft = {
    id,
    kind,
    title,
    ...(typeof value.text === "string" ? { text: value.text } : {}),
    ...(value.status === "draft" || value.status === "active" || value.status === "retired" || value.status === "superseded"
      ? { status: value.status }
      : {}),
    ...(isRecord(value.fields) ? { fields: value.fields } : {}),
  };
  return [draft];
}

function isNodeKind(value: unknown): value is NodeDraft["kind"] {
  return (
    value === "decision" ||
    value === "spec_item" ||
    value === "edge_case" ||
    value === "rule" ||
    value === "journey" ||
    value === "contract" ||
    value === "arch_node" ||
    value === "research_fact" ||
    value === "plan" ||
    value === "feature" ||
    value === "task" ||
    value === "check" ||
    value === "waiver" ||
    value === "ccr" ||
    value === "source" ||
    value === "asset" ||
    value === "comment"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
