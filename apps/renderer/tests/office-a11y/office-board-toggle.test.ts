import { describe, expect, it } from "vitest";
import { OfficeA11yCoordinator } from "../../src/office/a11y/index.js";
import {
  MemoryAnimationDirector,
  MemoryBoardView,
  MemoryCamera,
  MemoryCenterTabs,
  MemoryFocusMode,
  MemoryInbox,
  MemoryInspector,
  MemoryMediaQuery,
  MemoryPhasePreset,
  MemoryPixiTicker,
  MemoryPressureMachine,
} from "./fixtures.js";

function createCoordinator() {
  return new OfficeA11yCoordinator({
    media: new MemoryMediaQuery(),
    director: new MemoryAnimationDirector(),
    phasePreset: new MemoryPhasePreset(),
    pressure: new MemoryPressureMachine(),
    tabs: new MemoryCenterTabs(),
    board: new MemoryBoardView(),
    pixi: new MemoryPixiTicker(),
    focusMode: new MemoryFocusMode(),
    camera: new MemoryCamera(),
    inspector: new MemoryInspector(),
    inbox: new MemoryInbox(),
  });
}

describe("Office ↔ Board toggle", () => {
  it("preserves the inspected worker when pressing V", () => {
    const coordinator = createCoordinator();
    coordinator.setSelection({ agentId: "A0014", title: "print page", openedBy: "click" });

    const first = coordinator.toggleOfficeBoard();
    expect(first.tab).toBe("board");
    expect(first.selection?.agentId).toBe("A0014");

    const second = coordinator.toggleOfficeBoard();
    expect(second.tab).toBe("office");
    expect(second.selection?.title).toBe("print page");
  });
});