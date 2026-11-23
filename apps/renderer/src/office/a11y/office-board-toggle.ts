import type { BoardViewPort, CenterTabPort, CenterWorkspaceTab, OfficeSelection } from "./types.js";

export interface OfficeBoardToggleResult {
  readonly tab: CenterWorkspaceTab;
  readonly selection: OfficeSelection | null;
}

/**
 * Instant `V` shortcut toggling Office ↔ Board while preserving inspector selection.
 */
export function toggleOfficeBoardView(input: {
  readonly tabs: CenterTabPort;
  readonly board: BoardViewPort;
  readonly selection: OfficeSelection | null;
}): OfficeBoardToggleResult {
  const next: CenterWorkspaceTab = input.tabs.activeTab === "office" ? "board" : "office";
  input.tabs.setTab(next);
  if (next === "board") {
    input.board.showBoard(input.selection);
  } else {
    input.board.hideBoard();
  }
  return { tab: next, selection: input.selection };
}