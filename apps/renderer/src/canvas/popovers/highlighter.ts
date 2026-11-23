import type { CanvasNodeCatalog, CanvasViewportPort, MotionPreferencePort } from "./ports.js";
import { HIGHLIGHT_MS } from "./types.js";
import type { ActiveHighlight, GraphDelta, HighlightKind } from "./types.js";

export class PostSendChangeHighlighter {
  private delta: GraphDelta | null = null;
  private startedAt: number | null = null;
  viewChangesOpened = false;

  constructor(
    private readonly clock: { now(): number },
    private readonly canvas: CanvasViewportPort,
    private readonly labels: CanvasNodeCatalog,
    private readonly motion: MotionPreferencePort,
  ) {}

  commit(delta: GraphDelta): void {
    this.delta = {
      added: [...delta.added],
      updated: [...delta.updated],
      impacted: [...delta.impacted],
      removed: [...delta.removed],
    };
    this.startedAt = this.clock.now();
    this.viewChangesOpened = false;
  }

  active(): readonly ActiveHighlight[] {
    if (!this.delta || this.startedAt === null) return [];
    const elapsed = Math.max(0, this.clock.now() - this.startedAt);
    if (elapsed >= HIGHLIGHT_MS) return [];
    const reduced = this.motion.prefersReducedMotion();
    const opacity = 1 - elapsed / HIGHLIGHT_MS;
    const items: ActiveHighlight[] = [];
    const assigned = new Set<string>();
    const take = (ids: readonly string[], kind: HighlightKind): void => {
      for (const nodeId of ids) {
        if (assigned.has(nodeId)) continue;
        assigned.add(nodeId);
        items.push(this.decorate(nodeId, kind, reduced, kind === "removed" ? opacity : 1));
      }
    };
    take(this.delta.removed, "removed");
    take(this.delta.added, "new");
    take(this.delta.updated, "updated");
    take(this.delta.impacted, "rechecking");
    return items;
  }

  recap(): string | null {
    if (!this.delta || this.startedAt === null) return null;
    const elapsed = Math.max(0, this.clock.now() - this.startedAt);
    if (elapsed >= HIGHLIGHT_MS) return null;
    const offscreen = this.delta.updated.filter((id) => this.canvas.isOffscreen(id));
    if (offscreen.length > 0) {
      const target = offscreen[0] ?? "";
      return `${this.delta.updated.length} updated (${offscreen.length} off-screen) — Jump to ${this.labels.label(target)}`;
    }
    const updated = this.delta.updated.length;
    const updatedLabel = updated === 1 ? "1 box updated" : `${updated} boxes updated`;
    return `${updatedLabel} · ${this.delta.added.length} added · ${this.delta.impacted.length} held — View changes`;
  }

  firstOffscreenUpdated(): string | null {
    if (!this.delta) return null;
    return this.delta.updated.find((id) => this.canvas.isOffscreen(id)) ?? null;
  }

  private decorate(
    nodeId: string,
    kind: HighlightKind,
    reduced: boolean,
    opacity: number,
  ): ActiveHighlight {
    const offscreen = this.canvas.isOffscreen(nodeId);
    if (kind === "new") {
      return {
        nodeId,
        kind,
        badge: "+ New",
        tone: "green",
        pulse: !reduced,
        outline: false,
        strike: false,
        opacity,
        offscreen,
        staticContrast: reduced,
      };
    }
    if (kind === "updated") {
      return {
        nodeId,
        kind,
        badge: "Updated",
        tone: "violet",
        pulse: !reduced,
        outline: false,
        strike: false,
        opacity,
        offscreen,
        staticContrast: reduced,
      };
    }
    if (kind === "rechecking") {
      return {
        nodeId,
        kind,
        badge: "Re-checking",
        tone: "amber",
        pulse: false,
        outline: true,
        strike: false,
        opacity,
        offscreen,
        staticContrast: reduced,
      };
    }
    return {
      nodeId,
      kind,
      badge: "Removed / Deferred",
      tone: "faded",
      pulse: false,
      outline: false,
      strike: true,
      opacity,
      offscreen,
      staticContrast: reduced,
    };
  }
}
