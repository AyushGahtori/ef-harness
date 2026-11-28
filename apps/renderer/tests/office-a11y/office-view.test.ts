import { describe, expect, it } from "vitest";

import { createView } from "../cockpit-board/fixtures.js";
import { loadFloorPlan, makeSnapshot, makeWorker } from "../office-cast/fixtures.js";
import { BoardHealthSignalEngine } from "../../src/cockpit/health/engine.js";
import { OfficeView, governorPressureFromShell } from "../../src/office/a11y/index.js";
import { OfficeCameraController } from "../../src/office/renderer/office-camera-controller.js";
import { ROOM_IDS } from "../../src/office/renderer/room-ids.js";
import { PhaseLayoutPresetManager } from "../../src/presets/phase-layout-preset-manager.js";
import { createConnectedShell } from "../../src/shell/shell.js";
import { MemoryMediaQuery, MemoryPixiTicker } from "./fixtures.js";

describe("OfficeView", () => {
  it("mounts the shell, seats the cast from the floor plan, and freezes motion on an ORANGE override", () => {
    const connected = createConnectedShell({ viewport: { width: 1280, height: 800 } });
    const plan = loadFloorPlan();
    const board = createView([]);
    const inboxOpens: string[] = [];
    const office = new OfficeView({
      plan,
      pressure: governorPressureFromShell(connected.pressure),
      layout: connected.shell.context,
      presets: new PhaseLayoutPresetManager(),
      environment: {
        projectId: "proj-office",
        prefersReducedMotion: false,
        governorLevel: "green",
        selection: null,
      },
      board: board.view,
      health: new BoardHealthSignalEngine({ liveClock: false }),
      inspector: board.inspector,
      inbox: {
        openManually() {
          inboxOpens.push("inbox");
        },
      },
      camera: new OfficeCameraController({
        viewportWidthPx: 1280,
        viewportHeightPx: 800,
        plan,
      }),
      pixi: new MemoryPixiTicker(),
      media: new MemoryMediaQuery(),
    });
    office.start();
    expect(office.grid.snapshot().roomDesks.size).toBe(ROOM_IDS.length);
    office.sync(makeSnapshot([makeWorker({ role: "verifier", agentId: "A0014", taskId: "T-14" })]), 5_000);
    expect(office.cast.project("A0014")?.truthfulRoomId).toBe("qa-verification-lab");
    const html = office.coordinator.renderMirrorHtml();
    for (const roomId of ROOM_IDS) {
      expect(html).toContain(`data-room="${roomId}"`);
    }
    expect(html).toContain('data-room="flagged"');

    connected.pressure.set("ORANGE", "ram");
    office.setOrangeOverride(true);
    expect(connected.shell.context.centerTab).toBe("office");
    expect(office.director.continuousMotionCount).toBe(0);

    office.click({ kind: "worker", agentId: "A0014", taskId: "T-14" });
    expect(board.opened[0]?.taskId).toBe("T-14");
    expect(board.opened[0]?.openedBy).toBe("click");
    office.click({ kind: "inbox-tray" });
    expect(inboxOpens).toEqual(["inbox"]);
    office.stop();
  });
});
