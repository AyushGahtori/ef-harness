import { describe, expect, it } from "vitest";
import {
  ArtifactLifecycleManager,
  InvalidLifecycleTransitionError,
} from "../../src/evals/index.js";

describe("ArtifactLifecycleManager", () => {
  it("enforces draft → evaluated → active → deprecated", () => {
    const mgr = new ArtifactLifecycleManager();
    mgr.registerDraft("batch-resolve@1", "v2");
    mgr.transition("batch-resolve@1", "evaluated", "eval-1");
    const active = mgr.transition("batch-resolve@1", "active", "eval-1");
    expect(active.state).toBe("active");
    const deprecated = mgr.transition("batch-resolve@1", "deprecated");
    expect(deprecated.state).toBe("deprecated");
  });

  it("blocks draft → active bypass", () => {
    const mgr = new ArtifactLifecycleManager();
    mgr.registerDraft("router@1", "v3");
    expect(() => mgr.transition("router@1", "active")).toThrow(InvalidLifecycleTransitionError);
    try {
      mgr.transition("router@1", "active");
    } catch (error) {
      expect((error as Error).message).toContain("draft → active forbidden");
    }
  });

  it("supports instant rollback of active artifact", () => {
    const mgr = new ArtifactLifecycleManager([
      { id: "prompt-v1", version: "v1", state: "deprecated" },
      { id: "prompt-v2", version: "v2", state: "active", rollbackPointer: "v1", evalRunId: "eval-9" },
    ]);
    const { promoted, demoted } = mgr.rollback("prompt-v2");
    expect(demoted.state).toBe("deprecated");
    expect(promoted.id).toBe("prompt-v1");
    expect(promoted.state).toBe("active");
  });
});