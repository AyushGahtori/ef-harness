import { describe, expect, it } from "vitest";
import { OfficeCastProjector, PaperAndParcelFlowVisuals } from "../../src/office/cast/index.js";
import { makeSnapshot } from "./fixtures.js";

describe("PaperAndParcelFlowVisuals", () => {
  const visuals = new PaperAndParcelFlowVisuals();

  it("reflects exact CEO inbox unread stack height", () => {
    const projection = visuals.project({
      workers: [],
      inboxCards: [
        { cardId: "i1", kind: "Decision", title: "Cutoff", actionable: true, resolved: false, priority: 1 },
        { cardId: "i2", kind: "Approval", title: "Stripe", actionable: true, resolved: false, priority: 2 },
        { cardId: "i3", kind: "Tool", title: "Playwright", actionable: true, resolved: true, priority: 3 },
      ],
      intakeItems: [],
      features: [],
    });
    expect(projection.tray.unreadBadge).toBe(2);
    expect(projection.tray.stackHeight).toBe(2);
    expect(projection.tray.clean).toBe(false);
  });

  it("aggregates multi-drop front-desk parcels", () => {
    const projection = visuals.project({
      workers: [],
      inboxCards: [],
      intakeItems: [
        { itemId: "j1", kind: "pdf", fileName: "a.pdf", phase: "scanning" },
        { itemId: "j2", kind: "pdf", fileName: "b.pdf", phase: "scanning" },
        { itemId: "j3", kind: "pdf", fileName: "c.pdf", phase: "scanning" },
        { itemId: "j4", kind: "pdf", fileName: "d.pdf", phase: "scanning" },
        { itemId: "j5", kind: "svg", fileName: "logo.svg", phase: "scanning" },
      ],
      features: [],
    });
    expect(projection.parcel?.itemCount).toBe(5);
    expect(projection.parcel?.label).toBe("5 items scanning...");
  });

  it("clears CEO tray and parcel when idle", () => {
    const projector = new OfficeCastProjector();
    const scene = projector.project(makeSnapshot([]));
    expect(scene.idle).toBe(true);
    expect(scene.tray.clean).toBe(true);
    expect(scene.parcel).toBeNull();
    expect(scene.phantomSpriteCount).toBe(0);
  });
});