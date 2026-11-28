export interface EscapeState {
  popoverOpen: boolean;
  selectedIds: readonly string[];
  nodeId: string | null;
}

export interface EscapeResult {
  popoverOpen: boolean;
  selectedIds: readonly string[];
  owner: "node" | "popover";
  nodeId: string | null;
}

export function reduceEscape(state: EscapeState): EscapeResult {
  if (state.popoverOpen) {
    return {
      popoverOpen: false,
      selectedIds: state.selectedIds,
      owner: "node",
      nodeId: state.nodeId,
    };
  }
  return {
    popoverOpen: false,
    selectedIds: [],
    owner: "node",
    nodeId: state.nodeId,
  };
}
