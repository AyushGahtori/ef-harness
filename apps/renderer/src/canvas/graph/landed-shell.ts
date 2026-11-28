import type { ShellLayoutContext } from "../../shell/shell.js";
import { defaultCanvasFilters } from "./local-ports.js";
import type { ShellLayoutContextPort } from "./ports.js";
import type { CanvasFilterState, CanvasViewportState, ShellLayoutCanvasSlice } from "./types.js";

/**
 * Adapts Task 122 `ShellLayoutContext.readCanvas` / `writeCanvas`.
 * The landed slice stores `{ x, y, zoom, filters: string[] }`.
 */
export class LandedShellCanvasPort implements ShellLayoutContextPort {
  constructor(private readonly shell: ShellLayoutContext) {}

  readCanvas(): ShellLayoutCanvasSlice {
    const landed = this.shell.readCanvas();
    return {
      viewport: { x: landed.x, y: landed.y, zoom: landed.zoom },
      filters: decodeFilters(landed.filters),
    };
  }

  writeCanvas(slice: Partial<ShellLayoutCanvasSlice>): void {
    const current = this.readCanvas();
    const viewport = slice.viewport ?? current.viewport;
    const filters = slice.filters ?? current.filters;
    this.shell.writeCanvas({
      x: viewport.x,
      y: viewport.y,
      zoom: viewport.zoom,
      filters: encodeFilters(filters),
    });
  }

  hasSavedSession(): boolean {
    const landed = this.shell.readCanvas();
    return landed.x !== 0 || landed.y !== 0 || landed.zoom !== 1 || landed.filters.length > 0;
  }
}

function encodeFilters(filters: CanvasFilterState): string[] {
  const tokens: string[] = [];
  if (filters.status !== "all") tokens.push(`status:${filters.status}`);
  if (filters.nodeType !== "all") tokens.push(`type:${filters.nodeType}`);
  if (filters.brownfieldLayer !== "both") tokens.push(`layer:${filters.brownfieldLayer}`);
  if (filters.phase !== "all") tokens.push(`phase:${filters.phase}`);
  if (filters.searchQuery.length > 0) tokens.push(`q:${filters.searchQuery}`);
  return tokens;
}

function decodeFilters(tokens: readonly string[]): CanvasFilterState {
  const filters = defaultCanvasFilters();
  let status = filters.status;
  let nodeType = filters.nodeType;
  let brownfieldLayer = filters.brownfieldLayer;
  let phase = filters.phase;
  let searchQuery = filters.searchQuery;
  for (const token of tokens) {
    if (token.startsWith("status:")) status = token.slice("status:".length) as CanvasFilterState["status"];
    else if (token.startsWith("type:")) nodeType = token.slice("type:".length) as CanvasFilterState["nodeType"];
    else if (token.startsWith("layer:")) {
      brownfieldLayer = token.slice("layer:".length) as CanvasFilterState["brownfieldLayer"];
    } else if (token.startsWith("phase:")) phase = token.slice("phase:".length) as CanvasFilterState["phase"];
    else if (token.startsWith("q:")) searchQuery = token.slice("q:".length);
  }
  return { status, nodeType, brownfieldLayer, phase, searchQuery };
}

export function viewportOf(slice: ShellLayoutCanvasSlice): CanvasViewportState {
  return slice.viewport;
}
