import type {
  BoxChatIntent,
  CanvasNode,
  GraphEdge,
  PanZoomTarget,
  Rect,
} from "./types.js";

export interface BoxSelectionSync {
  nodeIds: readonly string[];
  nodeRevisions: readonly number[];
  labels: readonly string[];
}

export interface ComposerSyncReceipt {
  hijackedQuestion: false;
  submittedAnswer: false;
  activeTarget: "question" | "box" | "general";
  pill: string;
  nodeIds: readonly string[];
  nodeRevisions: readonly number[];
  optionsVersion: number | null;
  questionDraft: string;
}

export interface OpenQuestion {
  id: string;
  title: string;
  draft: string;
  optionsVersion: number;
}

export interface ComposerTargetPort {
  syncBoxSelection(selection: BoxSelectionSync): ComposerSyncReceipt;
}

export interface CanvasSelectionContextPort {
  read(): readonly string[];
  write(nodeIds: readonly string[]): void;
  subscribe(listener: () => void): () => void;
}

export interface CanvasNodeCatalog {
  get(nodeId: string): CanvasNode | null;
  list(): readonly CanvasNode[];
  archive(nodeId: string): void;
  label(nodeId: string): string;
}

export interface CanvasViewportPort {
  viewport(): Rect;
  setViewport(viewport: Rect): void;
  panZoomTo(nodeId: string): PanZoomTarget;
  focusConnected(nodeIds: readonly string[]): readonly string[];
  isOffscreen(nodeId: string): boolean;
  setOffscreen(nodeIds: readonly string[]): void;
  setEdges(edges: readonly GraphEdge[]): void;
  lastPan(): PanZoomTarget | null;
  neighborhood(): readonly string[];
}

export interface MotionPreferencePort {
  prefersReducedMotion(): boolean;
  setPrefersReducedMotion(reduced: boolean): void;
}

export interface IntentLaunch {
  intent: BoxChatIntent;
  nodeIds: readonly string[];
  nodeRevisions: readonly number[];
  tokens: number;
  label: string;
  combined: boolean;
}

export interface BoxChatIntentPort {
  launch(input: IntentLaunch): void;
}

export interface InspectorPin {
  kind: "canvas-node";
  id: string;
  title: string;
  ownerTask: "Task 154";
}

export interface InspectorShellPort {
  pin(node: CanvasNode, body: string): InspectorPin;
  current(): InspectorPin | null;
  expanded(): string;
}

export interface SiblingCall {
  sibling: string;
  method: string;
  nodeId: string;
  tokens: number;
  detail: string;
}

export interface SiblingActionPort {
  call(input: SiblingCall): void;
}
