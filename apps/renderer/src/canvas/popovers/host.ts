import { countNodes, h, textContent } from "./a11y.js";
import { placePopover, placementInside } from "./geometry.js";
import { reduceEscape } from "./keyboard.js";
import {
  LocalBoxChatIntentController,
  LocalComposerTargetStateMachine,
  LocalInspectorShell,
  LocalInteractiveArchitectureCanvas,
  LocalMotionPreference,
  LocalSiblingActionBus,
  LocalCanvasSelectionContext,
  ManualClock,
  MemoryCanvasNodeCatalog,
} from "./local-ports.js";
import type { OpenQuestion } from "./ports.js";
import { modelText, NodeTypePopoverRegistry, popoverOmitsSealedSource } from "./registry.js";
import {
  renderComposerPill,
  renderHighlights,
  renderPill,
  renderPopover,
  renderRecap,
  renderToolbar,
} from "./render.js";
import { selectionPillText, MultiBoxSelectionController } from "./selection.js";
import { CanvasQuickActionToolbar } from "./toolbar.js";
import { PostSendChangeHighlighter } from "./highlighter.js";
import { INK, PAPER, POPOVER_HEIGHT, POPOVER_WIDTH } from "./types.js";
import type {
  CanvasNode,
  GraphDelta,
  GraphEdge,
  Placement,
  PopoverModel,
  Rect,
  VChild,
  VNode,
} from "./types.js";

export interface PopoverHostOptions {
  nodes: readonly CanvasNode[];
  edges?: readonly GraphEdge[];
  viewport?: Rect;
  reducedMotion?: boolean;
}

export class CanvasPopoverHost {
  readonly clock = new ManualClock();
  readonly catalog: MemoryCanvasNodeCatalog;
  readonly selectionContext = new LocalCanvasSelectionContext();
  readonly composer = new LocalComposerTargetStateMachine();
  readonly canvas: LocalInteractiveArchitectureCanvas;
  readonly motion: LocalMotionPreference;
  readonly intents = new LocalBoxChatIntentController();
  readonly inspector = new LocalInspectorShell();
  readonly siblings = new LocalSiblingActionBus();
  readonly selection: MultiBoxSelectionController;
  readonly registry = new NodeTypePopoverRegistry();
  readonly toolbar: CanvasQuickActionToolbar;
  readonly highlighter: PostSendChangeHighlighter;

  private openId: string | null = null;
  private anchorRect: Rect | null = null;
  private focusOwner: "node" | "popover" = "node";
  private focusNodeId: string | null = null;
  private pinned = false;

  constructor(options: PopoverHostOptions) {
    this.catalog = new MemoryCanvasNodeCatalog(options.nodes);
    this.canvas = new LocalInteractiveArchitectureCanvas(this.catalog, options.viewport);
    this.motion = new LocalMotionPreference(options.reducedMotion ?? false);
    this.canvas.setEdges(options.edges ?? []);
    this.selection = new MultiBoxSelectionController(this.catalog, this.selectionContext, this.composer);
    this.toolbar = new CanvasQuickActionToolbar(this.intents, this.canvas);
    this.highlighter = new PostSendChangeHighlighter(this.clock, this.canvas, this.catalog, this.motion);
  }

  click(nodeId: string, mods?: { shift?: boolean; ctrl?: boolean }): void {
    const node = this.catalog.get(nodeId);
    if (!node) return;
    if (mods?.shift || mods?.ctrl) {
      this.selection.add(nodeId);
      this.openId = null;
      this.pinned = false;
      this.focusOwner = "node";
      this.focusNodeId = nodeId;
      return;
    }
    this.selection.selectOnly(nodeId);
    this.openId = nodeId;
    this.anchorRect = node.rect;
    this.pinned = false;
    this.focusOwner = "popover";
    this.focusNodeId = nodeId;
  }

  marquee(rect: Rect): void {
    this.selection.marquee(rect);
    this.openId = null;
    this.pinned = false;
    this.focusOwner = "node";
    const ids = this.selection.selectedIds;
    const last = ids[ids.length - 1];
    if (last !== undefined) this.focusNodeId = last;
  }

  clearSelection(): void {
    this.selection.clear();
    this.openId = null;
    this.pinned = false;
    this.focusOwner = "node";
  }

  escape(): void {
    const result = reduceEscape({
      popoverOpen: this.openId !== null,
      selectedIds: this.selection.selectedIds,
      nodeId: this.focusNodeId,
    });
    this.focusOwner = result.owner;
    this.focusNodeId = result.nodeId;
    if (this.openId !== null) {
      this.openId = null;
      return;
    }
    if (result.selectedIds.length === 0) this.selection.clear();
  }

  pin(): void {
    this.activatePopoverAction("pin");
  }

  activateToolbar(actionId: string): void {
    if (actionId === "clear") {
      this.clearSelection();
      return;
    }
    this.toolbar.activate(actionId, this.selection.selectedNodes());
  }

  activatePopoverAction(actionId: string): void {
    const model = this.model();
    if (!model) return;
    const action = model.actions.find((item) => item.id === actionId);
    if (!action) return;
    if (action.kind === "close") {
      this.openId = null;
      this.focusOwner = "node";
      return;
    }
    if (action.kind === "pin") {
      const node = this.openId ? this.catalog.get(this.openId) : null;
      if (!node) return;
      this.inspector.pin(node, modelText(model));
      this.pinned = true;
      return;
    }
    const node = this.openId ? this.catalog.get(this.openId) : null;
    if (!node) return;
    if (action.kind === "intent") {
      this.intents.launch({
        intent: action.intent,
        nodeIds: [node.id],
        nodeRevisions: [node.revision],
        tokens: action.tokens,
        label: action.label,
        combined: false,
      });
      return;
    }
    const detail = safeDetail(model, node);
    if (action.method === "viewRelations" || action.method === "showMatchedTasks") {
      this.canvas.focusConnected([node.id]);
    }
    this.siblings.call({
      sibling: action.sibling,
      method: action.method,
      nodeId: node.id,
      tokens: action.tokens,
      detail,
    });
  }

  activateLink(nodeId: string): void {
    this.canvas.panZoomTo(nodeId);
    const node = this.catalog.get(nodeId);
    if (!node) {
      this.openId = nodeId;
      this.anchorRect = { x: 8, y: 8, width: 24, height: 24 };
      this.focusOwner = "popover";
      this.focusNodeId = nodeId;
      return;
    }
    this.selection.selectOnly(nodeId);
    this.openId = nodeId;
    this.anchorRect = node.rect;
    this.focusOwner = "popover";
    this.focusNodeId = nodeId;
  }

  archive(nodeId: string): void {
    this.catalog.archive(nodeId);
    this.selection.drop(nodeId);
  }

  commitDelta(delta: GraphDelta): void {
    this.highlighter.commit(delta);
  }

  setReducedMotion(reduced: boolean): void {
    this.motion.setPrefersReducedMotion(reduced);
  }

  setOffscreen(nodeIds: readonly string[]): void {
    this.canvas.setOffscreen(nodeIds);
  }

  setViewport(viewport: Rect): void {
    this.canvas.setViewport(viewport);
  }

  advance(ms: number): void {
    this.clock.advance(ms);
  }

  openQuestion(question: OpenQuestion): void {
    this.composer.openUnansweredQuestion(question);
    this.selection.resync();
  }

  switchComposerToBox(): void {
    this.composer.switchComposerToBox();
  }

  activateRecap(): void {
    const target = this.highlighter.firstOffscreenUpdated();
    if (target) {
      this.canvas.panZoomTo(target);
      return;
    }
    this.highlighter.viewChangesOpened = true;
  }

  pill(): string | null {
    return selectionPillText(this.selection.selectedNodes());
  }

  recap(): string | null {
    return this.highlighter.recap();
  }

  placement(): Placement | null {
    if (this.openId === null || this.anchorRect === null) return null;
    return placePopover(this.anchorRect, { width: POPOVER_WIDTH, height: POPOVER_HEIGHT }, this.canvas.viewport());
  }

  placementInsideViewport(): boolean {
    const placement = this.placement();
    if (!placement) return false;
    return placementInside(placement, this.canvas.viewport());
  }

  focus(): { owner: "node" | "popover"; nodeId: string | null } {
    return { owner: this.focusOwner, nodeId: this.focusNodeId };
  }

  popoverOpen(): boolean {
    return this.openId !== null;
  }

  model(): PopoverModel | null {
    if (this.openId === null) return null;
    const node = this.catalog.get(this.openId);
    if (!node) return this.registry.archived(this.openId);
    return this.registry.describe(node);
  }

  popoverText(): string {
    const model = this.model();
    return model ? modelText(model) : "";
  }

  toolbarLabels(): readonly string[] {
    return this.toolbar.actionsFor(this.selection.selectedIds.length).map((action) => action.label);
  }

  dialogCount(): number {
    return countNodes(this.render(), (node) => node.props.role === "dialog");
  }

  render(): VNode {
    const children: VChild[] = [renderComposerPill(this.composer.visiblePill())];
    const pill = this.pill();
    if (pill) children.push(renderPill(pill));
    const actions = this.toolbar.actionsFor(this.selection.selectedIds.length);
    if (actions.length > 0) children.push(renderToolbar(actions));
    const model = this.model();
    const placement = this.placement();
    if (model && placement) children.push(renderPopover(model, placement, this.pinned));
    const highlights = this.highlighter.active();
    if (highlights.length > 0) children.push(renderHighlights(highlights));
    const recap = this.highlighter.recap();
    if (recap) children.push(renderRecap(recap));
    return h(
      "section",
      {
        id: "canvas-popover-host",
        ariaLabel: "Architecture canvas selection",
        fg: INK,
        bg: PAPER,
        attrs: {
          "data-focus-owner": this.focusOwner,
          "data-focus-node": this.focusNodeId ?? "",
        },
      },
      children,
    );
  }
}

export function createCanvasPopoverHost(options: PopoverHostOptions): CanvasPopoverHost {
  return new CanvasPopoverHost(options);
}

export function renderedText(node: VNode): string {
  return textContent(node);
}

function safeDetail(model: PopoverModel, node: CanvasNode): string {
  const text = modelText(model);
  if ((node.type === "check" || node.type === "oracle") && !popoverOmitsSealedSource(model, node.sealedSource)) {
    return "Sealed check · receipt hidden during active build";
  }
  return text;
}
