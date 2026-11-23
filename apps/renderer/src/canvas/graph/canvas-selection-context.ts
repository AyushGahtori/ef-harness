export interface CanvasSelectionState {
  readonly selectedNodeIds: readonly string[];
  readonly focusedNodeId: string | null;
  readonly focusNeighborhoodActive: boolean;
}

export class CanvasSelectionContext {
  private state: CanvasSelectionState = {
    selectedNodeIds: [],
    focusedNodeId: null,
    focusNeighborhoodActive: false,
  };

  snapshot(): CanvasSelectionState {
    return this.state;
  }

  selectSingle(nodeId: string): void {
    this.state = {
      selectedNodeIds: [nodeId],
      focusedNodeId: nodeId,
      focusNeighborhoodActive: false,
    };
  }

  toggleSelect(nodeId: string): void {
    const set = new Set(this.state.selectedNodeIds);
    if (set.has(nodeId)) set.delete(nodeId);
    else set.add(nodeId);
    this.state = {
      selectedNodeIds: [...set],
      focusedNodeId: nodeId,
      focusNeighborhoodActive: false,
    };
  }

  clear(): void {
    this.state = { selectedNodeIds: [], focusedNodeId: null, focusNeighborhoodActive: false };
  }

  focusConnected(nodeId: string): void {
    this.state = {
      selectedNodeIds: [nodeId],
      focusedNodeId: nodeId,
      focusNeighborhoodActive: true,
    };
  }
}