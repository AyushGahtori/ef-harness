import { describe, expect, it, vi } from "vitest";
import { OFFICE_MIRROR_TAB_GROUPS, OfficeSemanticMirrorTree } from "../../src/office/a11y/index.js";
import { ROOM_IDS } from "../../src/office/renderer/room-ids.js";
import { makeWorker, MemoryCamera, MemoryInbox, MemoryInspector } from "./fixtures.js";

describe("OfficeSemanticMirrorTree", () => {
  it("traverses rooms in operational order and pans the camera on focus", () => {
    const camera = new MemoryCamera();
    const mirror = new OfficeSemanticMirrorTree(camera, new MemoryInspector(), new MemoryInbox());
    mirror.replaceWorkers(
      [
        makeWorker({ agentId: "A0014", title: "print page", roomId: "qa-verification-lab", priority: 10 }),
        makeWorker({
          agentId: "A0002",
          title: "flagged fix",
          roomId: "engineering-bullpen",
          flagged: true,
          priority: 20,
        }),
        makeWorker({ agentId: "A0001", title: "inbox flow", roomId: "ceo-office", inboxItem: true, priority: 30 }),
      ],
      2,
    );

    const nodes = mirror.focusNodes();
    const roomOrder = nodes.map((node) => node.roomId);
    for (let index = 1; index < roomOrder.length; index += 1) {
      const left = OFFICE_MIRROR_TAB_GROUPS.indexOf(roomOrder[index - 1]!);
      const right = OFFICE_MIRROR_TAB_GROUPS.indexOf(roomOrder[index]!);
      expect(left).toBeLessThanOrEqual(right);
    }

    const focused = mirror.handleKeyDown({ key: "Tab", shiftKey: false });
    expect(focused.type).toBe("focus");
    if (focused.type === "focus") {
      expect(camera.pans.at(-1)).toBe(focused.node.agentId);
    }
  });

  it("opens the Worker Inspector on Enter and debounces aria-live announcements", () => {
    vi.useFakeTimers();
    const inspector = new MemoryInspector();
    const mirror = new OfficeSemanticMirrorTree(new MemoryCamera(), inspector, new MemoryInbox());
    mirror.replaceWorkers(
      [makeWorker({ agentId: "A0014", title: "print page", roomId: "engineering-bullpen" })],
      0,
    );
    mirror.handleKeyDown({ key: "Tab", shiftKey: false });
    const activated = mirror.handleKeyDown({ key: "Enter", shiftKey: false });
    expect(activated.type).toBe("activate");
    expect(inspector.opened[0]?.agentId).toBe("A0014");

    mirror.announce("1 decision needs your input");
    mirror.announce("1 decision needs your input");
    mirror.announce("Feature Orders moved to Merge Bay");
    vi.advanceTimersByTime(1_600);
    const announced = mirror.drainAriaLive();
    expect(announced).toContain("Merge Bay");
    const html = mirror.renderHtml();
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Merge Bay");
    for (const roomId of ROOM_IDS) {
      expect(html).toContain(`data-room="${roomId}"`);
    }
    expect(html).toContain('data-room="flagged"');
    vi.useRealTimers();
  });

  it("exits the mirror toward inspector and composer without trapping focus", () => {
    const mirror = new OfficeSemanticMirrorTree(new MemoryCamera(), new MemoryInspector(), new MemoryInbox());
    mirror.replaceWorkers([makeWorker({ agentId: "A0099", title: "only worker" })], 0);
    mirror.handleKeyDown({ key: "Tab", shiftKey: false });
    const exit = mirror.handleKeyDown({ key: "Tab", shiftKey: false });
    expect(exit.type).toBe("exit");
    if (exit.type === "exit") expect(exit.target).toBe("inspector");
  });
});