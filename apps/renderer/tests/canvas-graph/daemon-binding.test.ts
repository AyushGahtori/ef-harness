import { describe, expect, it } from "vitest";
import { bindCanvasComposer } from "../../src/canvas/bind-shell.js";
import { createConnectedShell } from "../../src/shell/shell.js";
import type { FeatureNode } from "../../src/canvas/popovers/types.js";

const feature: FeatureNode = {
  id: "F1",
  type: "feature",
  revision: 3,
  label: "Kitchen",
  rect: { x: 0, y: 0, width: 180, height: 56 },
  evidence: { quote: "print totals", locator: "brief:1" },
  wave: 1,
  runtime: "WORKING",
  tasksDone: 0,
  tasksTotal: 2,
};

describe("daemon-backed canvas composer", () => {
  it("updates the composer target from a canvas selection and posts dictation over IPC", () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const rows = [{ nodeId: "F1", viewLevel: 2, x: 12, y: 34, pinnedByUser: true }];
    const shell = createConnectedShell().shell;
    const binding = bindCanvasComposer({
      shell,
      nodes: [feature],
      dispatch(method, params) {
        calls.push({ method, params });
        if (method === "canvas.layout.load") return { rows };
        return { ok: true };
      },
    });

    const projection = binding.select(feature);
    expect(projection.target.kind).toBe("Box");
    if (projection.target.kind === "Box") {
      expect(projection.target.boxes.map((box) => box.nodeId)).toEqual(["F1"]);
    }
    expect(binding.selection.snapshot().selectedNodeIds).toEqual(["F1"]);
    expect(binding.lastPopover?.title.length).toBeGreaterThan(0);
    expect(shell.readArchitectureCanvas()?.kind).toBe("architecture-canvas");

    binding.pressMic();
    expect(calls.some((call) => call.method === "composer.dictation.setRecording" && call.params.active === true)).toBe(
      true,
    );
    binding.composer.insertText("hold the pin");
    expect(calls.some((call) => call.method === "composer.focus.begin")).toBe(true);
    const focus = calls.find((call) => call.method === "composer.focus.begin");
    expect(focus?.params.selectedCanvasNodeIds).toEqual(["F1"]);

    binding.positions.hydrate(2);
    expect(binding.positions.getPinned("F1", 2)?.x).toBe(12);
    binding.shellSlice.writeCanvas({ viewport: { x: 8, y: 9, zoom: 1.25 } });
    expect(shell.readCanvas()).toMatchObject({ x: 8, y: 9, zoom: 1.25 });
  });
});
