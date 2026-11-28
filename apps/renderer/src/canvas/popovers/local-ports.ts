import type {
  BoxChatIntentPort,
  BoxSelectionSync,
  CanvasNodeCatalog,
  CanvasSelectionContextPort,
  CanvasViewportPort,
  ComposerSyncReceipt,
  ComposerTargetPort,
  InspectorPin,
  InspectorShellPort,
  IntentLaunch,
  MotionPreferencePort,
  OpenQuestion,
  SiblingActionPort,
  SiblingCall,
} from "./ports.js";
import type { CanvasNode, GraphEdge, PanZoomTarget, Rect } from "./types.js";
import { PAN_ZOOM } from "./types.js";

export class ManualClock {
  private millis = 0;

  now(): number {
    return this.millis;
  }

  advance(ms: number): void {
    this.millis += ms;
  }
}

export class MemoryCanvasNodeCatalog implements CanvasNodeCatalog {
  private readonly nodes: CanvasNode[];
  private readonly archived = new Set<string>();

  constructor(nodes: readonly CanvasNode[]) {
    this.nodes = [...nodes];
  }

  get(nodeId: string): CanvasNode | null {
    if (this.archived.has(nodeId)) return null;
    return this.nodes.find((node) => node.id === nodeId) ?? null;
  }

  list(): readonly CanvasNode[] {
    return this.nodes.filter((node) => !this.archived.has(node.id));
  }

  archive(nodeId: string): void {
    if (this.nodes.some((node) => node.id === nodeId)) this.archived.add(nodeId);
  }

  label(nodeId: string): string {
    return this.get(nodeId)?.label ?? nodeId;
  }
}

export class LocalCanvasSelectionContext implements CanvasSelectionContextPort {
  private ids: readonly string[] = [];
  private readonly listeners = new Set<() => void>();

  read(): readonly string[] {
    return this.ids;
  }

  write(nodeIds: readonly string[]): void {
    this.ids = [...nodeIds];
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class LocalComposerTargetStateMachine implements ComposerTargetPort {
  private question: (OpenQuestion & { unanswered: true }) | null = null;
  private box: BoxSelectionSync | null = null;
  private preview: BoxSelectionSync | null = null;
  activeTarget: "question" | "box" | "general" = "general";
  readonly submissions: { target: string; text: string }[] = [];
  lastReceipt: ComposerSyncReceipt | null = null;

  openUnansweredQuestion(question: OpenQuestion): void {
    this.question = { ...question, unanswered: true };
    this.activeTarget = "question";
    this.preview = null;
  }

  questionDraft(): string {
    return this.question?.draft ?? "";
  }

  optionsVersion(): number | null {
    return this.question?.optionsVersion ?? null;
  }

  visiblePill(): string {
    if (this.question && this.preview && this.preview.nodeIds.length > 0) {
      return talkingAbout(this.preview.labels, "Switch composer to this box");
    }
    if (this.question && this.activeTarget === "question") {
      return `Replying to: ${this.question.title} [${this.question.id}] · ✕`;
    }
    if (this.box && this.box.nodeIds.length > 0 && this.activeTarget === "box") {
      return talkingAbout(this.box.labels, "✕");
    }
    return "Message project / steering";
  }

  syncBoxSelection(selection: BoxSelectionSync): ComposerSyncReceipt {
    const holding = this.question !== null;
    if (holding && this.question) {
      this.preview = selection.nodeIds.length > 0 ? selection : null;
      const receipt: ComposerSyncReceipt = {
        hijackedQuestion: false,
        submittedAnswer: false,
        activeTarget: "question",
        pill:
          selection.nodeIds.length > 0
            ? talkingAbout(selection.labels, "Switch composer to this box")
            : `Replying to: ${this.question.title} [${this.question.id}] · ✕`,
        nodeIds: selection.nodeIds,
        nodeRevisions: selection.nodeRevisions,
        optionsVersion: this.question.optionsVersion,
        questionDraft: this.question.draft,
      };
      this.lastReceipt = receipt;
      return receipt;
    }
    this.preview = null;
    this.box = selection;
    this.activeTarget = selection.nodeIds.length === 0 ? "general" : "box";
    const receipt: ComposerSyncReceipt = {
      hijackedQuestion: false,
      submittedAnswer: false,
      activeTarget: this.activeTarget,
      pill: this.visiblePill(),
      nodeIds: selection.nodeIds,
      nodeRevisions: selection.nodeRevisions,
      optionsVersion: null,
      questionDraft: "",
    };
    this.lastReceipt = receipt;
    return receipt;
  }

  switchComposerToBox(): void {
    if (!this.preview || !this.question) return;
    this.box = this.preview;
    this.preview = null;
    this.activeTarget = this.box.nodeIds.length === 0 ? "general" : "box";
  }
}

export class LocalInteractiveArchitectureCanvas implements CanvasViewportPort {
  private view: Rect;
  private readonly offscreen = new Set<string>();
  private edges: readonly GraphEdge[] = [];
  private pan: PanZoomTarget | null = null;
  private focused: readonly string[] = [];
  readonly jumps: string[] = [];

  constructor(
    private readonly catalog: CanvasNodeCatalog,
    viewport: Rect = { x: 0, y: 0, width: 1280, height: 800 },
  ) {
    this.view = viewport;
  }

  viewport(): Rect {
    return this.view;
  }

  setViewport(viewport: Rect): void {
    this.view = viewport;
  }

  panZoomTo(nodeId: string): PanZoomTarget {
    const node = this.catalog.get(nodeId);
    const target: PanZoomTarget = {
      nodeId,
      x: node ? node.rect.x + node.rect.width / 2 : 0,
      y: node ? node.rect.y + node.rect.height / 2 : 0,
      zoom: PAN_ZOOM,
    };
    this.pan = target;
    this.jumps.push(nodeId);
    this.offscreen.delete(nodeId);
    return target;
  }

  focusConnected(nodeIds: readonly string[]): readonly string[] {
    const selected = new Set(nodeIds);
    const neighborhood = new Set(nodeIds);
    for (const edge of this.edges) {
      if (selected.has(edge.from) || selected.has(edge.to)) {
        neighborhood.add(edge.from);
        neighborhood.add(edge.to);
      }
    }
    this.focused = [...neighborhood];
    return this.focused;
  }

  isOffscreen(nodeId: string): boolean {
    return this.offscreen.has(nodeId);
  }

  setOffscreen(nodeIds: readonly string[]): void {
    this.offscreen.clear();
    for (const id of nodeIds) this.offscreen.add(id);
  }

  setEdges(edges: readonly GraphEdge[]): void {
    this.edges = edges;
  }

  lastPan(): PanZoomTarget | null {
    return this.pan;
  }

  neighborhood(): readonly string[] {
    return this.focused;
  }
}

export class LocalMotionPreference implements MotionPreferencePort {
  constructor(private reduced = false) {}

  prefersReducedMotion(): boolean {
    return this.reduced;
  }

  setPrefersReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
  }
}

export class LocalBoxChatIntentController implements BoxChatIntentPort {
  readonly launches: IntentLaunch[] = [];

  launch(input: IntentLaunch): void {
    const tokens =
      input.intent === "ask" || input.intent === "explain_impact" || input.intent === "focus_connected"
        ? 0
        : input.tokens;
    this.launches.push({ ...input, tokens });
  }
}

export class LocalInspectorShell implements InspectorShellPort {
  private pinState: InspectorPin | null = null;
  private body = "";

  pin(node: CanvasNode, body: string): InspectorPin {
    this.pinState = {
      kind: "canvas-node",
      id: node.id,
      title: node.label,
      ownerTask: "Task 154",
    };
    this.body = body;
    return this.pinState;
  }

  current(): InspectorPin | null {
    return this.pinState;
  }

  expanded(): string {
    return this.body;
  }
}

export class LocalSiblingActionBus implements SiblingActionPort {
  readonly calls: SiblingCall[] = [];

  call(input: SiblingCall): void {
    this.calls.push(input);
  }
}

function talkingAbout(labels: readonly string[], suffix: string): string {
  const first = labels[0] ?? "selection";
  if (labels.length <= 1) return `Talking about: ${first} · ${suffix}`;
  return `Talking about: ${first} (+${labels.length - 1} more) · ${suffix}`;
}
