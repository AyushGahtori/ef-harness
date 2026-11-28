import { describe, expect, it } from "vitest";
import { HelperSpriteClusterManager, OfficeCastProjector } from "../../src/office/cast/index.js";
import { makeHelper, makeSnapshot, makeWorker } from "./fixtures.js";

describe("HelperSpriteClusterManager", () => {
  it("caps visible helpers at 3 plus +N under a 14-shard burst", () => {
    const lead = makeWorker({ agentId: "A9000", taskId: "T-lead" });
    const helpers = Array.from({ length: 14 }, (_, index) => makeHelper("A9000", index));
    const projector = new OfficeCastProjector();
    const scene = projector.project(makeSnapshot([{ ...lead, helpers }]));
    expect(scene.helpers).toHaveLength(3);
    expect(scene.helperPills).toHaveLength(1);
    expect(scene.helperPills[0]?.text).toBe("+11");
    expect(scene.helperPills[0]?.hiddenCount).toBe(11);

    const manager = new HelperSpriteClusterManager();
    const cluster = manager.cluster(
      { agentId: lead.agentId, x: 10, y: 10 },
      helpers,
    );
    expect(cluster.sprites).toHaveLength(3);
    expect(cluster.pill?.text).toBe("+11");
  });
});