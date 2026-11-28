import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertAgentRuntimeAdapter } from "../../src/core/interface.js";
import { AdapterRegistry } from "../../src/core/registry.js";
import { GenericAcpAdapter } from "../../src/acp/adapter.js";
import { CodexRuntimeAdapter } from "../../src/codex/adapter.js";
import { createHarness, disposeHarness } from "../copilot/fakes.js";

describe("C56 adapter contract", () => {
  it("registers acp, codex, and copilot without a discard-port proxy default", async () => {
    const registry = new AdapterRegistry();
    const acp = new GenericAcpAdapter();
    const codex = new CodexRuntimeAdapter({ versionReader: async () => null });
    assertAgentRuntimeAdapter(acp);
    assertAgentRuntimeAdapter(codex);
    registry.register(acp, "observe_only", "landed");
    registry.register(codex, "observe_only", "landed");
    expect(registry.get("acp").adapter.runtime).toBe("acp");
    expect(registry.get("codex").adapter.runtime).toBe("codex");
    const probed = await codex.probe();
    expect(probed.status).toBe("missing");
    expect(probed.runtime).toBe("codex");

    const env = createHarness();
    try {
      assertAgentRuntimeAdapter(env.facade);
      registry.register(env.facade, "observe_only", "landed");
      expect(registry.get("copilot").adapter.runtime).toBe("copilot");
    } finally {
      await disposeHarness(env);
    }

    const codexSource = readFileSync(new URL("../../src/codex/adapter.ts", import.meta.url), "utf8");
    const copilotSource = readFileSync(new URL("../../src/copilot/ports.ts", import.meta.url), "utf8");
    expect(codexSource.includes("127.0.0.1:9")).toBe(false);
    expect(copilotSource.includes("127.0.0.1:9")).toBe(false);
    expect(codexSource.includes("taskkill")).toBe(false);
    expect(copilotSource.includes("taskkill")).toBe(false);
  });
});