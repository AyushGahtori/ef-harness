import type { CanonicalGraphNode, CanvasFilterState, CanvasStatusFilter } from "./types.js";

export interface SearchIndexEntry {
  readonly id: string;
  readonly haystack: string;
}

export class CanvasSearchAndFilterBar {
  private filters: CanvasFilterState = {
    status: "all",
    nodeType: "all",
    brownfieldLayer: "both",
    searchQuery: "",
    phase: "all",
  };

  private index: SearchIndexEntry[] = [];

  rebuildIndex(nodes: readonly CanonicalGraphNode[]): void {
    this.index = nodes.map((node) => ({
      id: node.id,
      haystack: `${node.id} ${node.title} ${node.text}`.toLowerCase(),
    }));
  }

  getFilters(): CanvasFilterState {
    return this.filters;
  }

  setFilters(next: Partial<CanvasFilterState>): void {
    this.filters = { ...this.filters, ...next };
  }

  searchMatches(query: string): readonly string[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    const hits: string[] = [];
    for (const row of this.index) {
      if (row.haystack.includes(trimmed)) hits.push(row.id);
    }
    return hits;
  }

  matchesStatus(node: CanonicalGraphNode, filter: CanvasStatusFilter): boolean {
    switch (filter) {
      case "all":
        return true;
      case "open":
        return node.status === "draft" || node.basis === "proposed";
      case "conflicts":
        return node.hasConflict;
      case "delegated":
        return node.basis === "delegated" || node.basis === "defaulted";
      case "working":
        return node.taskBadge === "working";
      case "held":
        return node.taskBadge === "held";
      case "done":
        return node.taskBadge === "done";
      default:
        return true;
    }
  }

  nodePasses(node: CanonicalGraphNode, filters: CanvasFilterState): boolean {
    if (filters.phase !== "all" && node.phase !== filters.phase) return false;
    if (filters.nodeType !== "all" && node.kind !== filters.nodeType) return false;
    if (!this.matchesStatus(node, filters.status)) return false;
    if (filters.brownfieldLayer !== "both") {
      if (filters.brownfieldLayer === "today" && node.brownfieldLayer !== "today") return false;
      if (filters.brownfieldLayer === "change" && node.brownfieldLayer !== "change") return false;
    }
    if (filters.searchQuery.trim()) {
      const matches = this.searchMatches(filters.searchQuery);
      if (!matches.includes(node.id)) return false;
    }
    return true;
  }
}