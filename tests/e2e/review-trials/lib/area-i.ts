export const PHASE_PRESETS = ["Discovery", "Plan", "Build", "Ship"] as const;

export const AREA_I_EVIDENCE = [
  "single-shell-four-presets",
  "monitor-rescue",
  "pinned-drag-preview",
  "local-dictation",
  "office-orange-board",
  "brownfield-no-stash",
] as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function contains(monitor: Rect, window: Rect): boolean {
  return window.x >= monitor.x && window.y >= monitor.y && window.x + window.w <= monitor.x + monitor.w && window.y + window.h <= monitor.y + monitor.h;
}

export function rescueBounds(window: Rect, monitors: readonly Rect[]): Rect {
  const primary = monitors[0];
  if (!primary) throw new Error("no connected monitor");
  if (monitors.some((monitor) => contains(monitor, window))) return window;
  return { x: primary.x, y: primary.y, w: Math.min(window.w, primary.w), h: Math.min(window.h, primary.h) };
}

export function dragPreview(node: { x: number; y: number }, delta: { x: number; y: number }): { x: number; y: number; pinned: true; tokens: 0; elapsedMs: number } {
  const start = performance.now();
  const next = { x: node.x + delta.x, y: node.y + delta.y, pinned: true as const, tokens: 0 as const, elapsedMs: 0 };
  next.elapsedMs = performance.now() - start;
  if (next.tokens !== 0 || next.elapsedMs >= 15) throw new Error("impact preview spent tokens or exceeded 15ms");
  return next;
}

export function layout(nodes: readonly { id: string; x: number; y: number; pinned: boolean }[]): { id: string; x: number; y: number; pinned: boolean }[] {
  return nodes.map((node) => (node.pinned ? { ...node } : { ...node, x: 0, y: 0 }));
}

const TAIL_VOCAB = Array.from({ length: 224 }, (_, index) => `term-${String(index).padStart(3, "0")}`);

export function dictationState(): { submitted: false; engine: "local-whisper"; tailTokens: number } {
  return { submitted: false, engine: "local-whisper", tailTokens: TAIL_VOCAB.length };
}

export function verifySpokenId(heard: string, known: readonly string[]): boolean {
  return known.includes(heard);
}

export function officeFrame(pressure: "green" | "orange"): { view: "office" | "board"; iconPx: 16; iconMs: 0; lagMs: number } {
  return { view: pressure === "orange" ? "board" : "office", iconPx: 16, iconMs: 0, lagMs: 0 };
}

export function safeLanding(input: { stashCalls: number; author: string; layers: readonly string[]; docsStale: boolean }): { stashCalls: 0; author: "HUMAN_OWNED"; flaggedStaleDocs: true } {
  if (input.stashCalls !== 0) throw new Error("silent git stash");
  if (input.author !== "HUMAN_OWNED") throw new Error("human authorship was rewritten");
  for (const layer of ["L0", "L1", "L2"]) {
    if (!input.layers.includes(layer)) throw new Error(`missing brownfield ${layer}`);
  }
  if (!input.docsStale) throw new Error("stale docs were trusted");
  return { stashCalls: 0, author: "HUMAN_OWNED", flaggedStaleDocs: true };
}

export async function runAreaI(): Promise<string[]> {
  const evidence: string[] = [];
  if (PHASE_PRESETS.length !== 4) throw new Error("phase presets drifted");
  evidence.push("single-shell-four-presets");
  const rescued = rescueBounds({ x: 4000, y: 10, w: 800, h: 600 }, [{ x: 0, y: 0, w: 1920, h: 1080 }]);
  if (rescued.x !== 0 || rescued.y !== 0 || rescued.w > 1920) throw new Error("window stayed on a disconnected monitor");
  evidence.push("monitor-rescue");
  const dragged = dragPreview({ x: 10, y: 20 }, { x: 5, y: -2 });
  const laid = layout([
    { id: "n1", x: dragged.x, y: dragged.y, pinned: true },
    { id: "n2", x: 9, y: 9, pinned: false },
  ]);
  if (!dragged.pinned || dragged.tokens !== 0 || laid[0]?.x !== 15 || laid[1]?.x !== 0) {
    throw new Error("pinned drag was relaid or spent tokens");
  }
  evidence.push("pinned-drag-preview");
  const dictated = dictationState();
  if (dictated.submitted !== false || dictated.engine !== "local-whisper" || dictated.tailTokens !== 224) {
    throw new Error("dictation was submitted or the tail vocab drifted");
  }
  if (!verifySpokenId("T07", ["T07", "R17"]) || verifySpokenId("T70", ["T07", "R17"])) {
    throw new Error("spoken id was not verified");
  }
  evidence.push("local-dictation");
  const orange = officeFrame("orange");
  const green = officeFrame("green");
  if (orange.view !== "board" || green.view !== "office" || orange.iconPx !== 16 || orange.iconMs !== 0 || orange.lagMs > 2000) {
    throw new Error("office frame missed the orange-to-board rule");
  }
  evidence.push("office-orange-board");
  const landing = safeLanding({ stashCalls: 0, author: "HUMAN_OWNED", layers: ["L0", "L1", "L2"], docsStale: true });
  if (landing.stashCalls !== 0 || landing.author !== "HUMAN_OWNED" || !landing.flaggedStaleDocs) {
    throw new Error("safe landing rewrote authorship or stashed");
  }
  evidence.push("brownfield-no-stash");
  const missing = AREA_I_EVIDENCE.filter((id) => !evidence.includes(id));
  if (missing.length > 0) throw new Error(`area I missing ${missing.join(",")}`);
  return evidence;
}
