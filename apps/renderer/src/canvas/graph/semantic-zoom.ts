import type { CanonicalGraphNode, SemanticZoomLevel } from "./types.js";
import { SEMANTIC_ZOOM_THRESHOLDS } from "./types.js";

export class SemanticZoomController {
  private level: SemanticZoomLevel = 3;
  private focusFeatureId: string | null = null;

  setFocusFeature(featureId: string | null): void {
    this.focusFeatureId = featureId;
    if (featureId) this.level = 4;
  }

  getLevel(): SemanticZoomLevel {
    return this.level;
  }

  levelFromViewportZoom(zoom: number): SemanticZoomLevel {
    if (this.focusFeatureId !== null) return 4;
    if (zoom < SEMANTIC_ZOOM_THRESHOLDS.level1Max) return 1;
    if (zoom < SEMANTIC_ZOOM_THRESHOLDS.level2Max) return 2;
    if (zoom < SEMANTIC_ZOOM_THRESHOLDS.level3Max) return 3;
    return 4;
  }

  applyViewportZoom(zoom: number): SemanticZoomLevel {
    if (this.focusFeatureId !== null) {
      this.level = 4;
      return 4;
    }
    this.level = this.levelFromViewportZoom(zoom);
    return this.level;
  }

  setLevelPill(level: SemanticZoomLevel): void {
    this.level = level;
    if (level < 4) this.focusFeatureId = null;
  }

  nodeVisibleAtLevel(node: CanonicalGraphNode, level: SemanticZoomLevel): boolean {
    switch (level) {
      case 1:
        return (
          node.kind === "project" ||
          node.kind === "scope" ||
          node.kind === "arch_node" ||
          node.kind === "feature" ||
          node.kind === "entity" ||
          node.kind === "integration" ||
          node.kind === "brownfield_module"
        );
      case 2:
        return (
          node.kind === "feature" ||
          node.kind === "contract" ||
          node.kind === "api_endpoint" ||
          node.kind === "screen_spec" ||
          node.kind === "seam" ||
          node.kind === "entity" ||
          node.kind === "arch_node"
        );
      case 3:
        return (
          node.kind === "decision" ||
          node.kind === "requirement" ||
          node.kind === "rule" ||
          node.kind === "spec_item" ||
          node.kind === "conflict"
        );
      case 4:
        return node.kind === "task" || node.kind === "feature" || this.focusFeatureId === node.feature;
      default:
        return true;
    }
  }

  clusterLabel(featureId: string, nodes: readonly CanonicalGraphNode[]): string {
    const tasks = nodes.filter((n) => n.feature === featureId && n.kind === "task");
    const total = tasks.length;
    const done = tasks.filter((t) => t.taskBadge === "done").length;
    const held = tasks.filter((t) => t.taskBadge === "held").length;
    const title = nodes.find((n) => n.id === featureId)?.title ?? featureId;
    return `${title} · ${done}/${total} done${held > 0 ? ` · ${held} held` : ""}`;
  }
}