import { describe, expect, it } from "vitest";
import { CliMinVersionGate, CLI_RUNTIMES } from "../../src/policy/index.js";
import { createEngine } from "./fixtures.js";

describe("CliMinVersionGate", () => {
  it("blocks outdated and denylisted CLIs with an upgrade card", () => {
    const { engine } = createEngine();
    engine.loadStartup();
    const gate = engine.cliGate();

    const codex = gate.evaluate("codex", "0.1.0");
    expect(codex.status).toBe("disabled");
    expect(codex.launchCodingTasks).toBe(false);
    expect(codex.reason).toBe("below_minimum");
    expect(codex.title).toBe("Update Codex to >= v0.42.0");
    expect(codex.card).toBe(
      "Codex CLI 0.1.0 is below minimum safe version 0.42.0 \u2014 Update CLI to enable",
    );

    const broken = gate.evaluate("codex", "0.41.0");
    expect(broken.reason).toBe("denylisted");
    expect(broken.status).toBe("disabled");
    expect(broken.card).toContain("leaks processes or breaks permission hooks");
    expect(broken.title).toBe("Update Codex to >= v0.42.0");

    expect(gate.evaluate("codex", "0.42.0")).toMatchObject({
      status: "allowed",
      launchCodingTasks: true,
      reason: "ok",
    });

    const copilot = gate.evaluate("copilot", "1.2.1");
    expect(copilot.status).toBe("observe-only");
    expect(copilot.launchCodingTasks).toBe(false);
    expect(copilot.reason).toBe("denylisted");
    expect(copilot.title).toBe("Update Copilot to >= v1.2.4");
    expect(copilot.card).toContain("Update CLI to enable");

    expect(gate.evaluate("copilot", "1.2.4").status).toBe("allowed");
    expect(gate.evaluate("not-a-runtime", "1.0.0").reason).toBe("unknown_runtime");
    expect(gate.evaluate("claude", "nope").reason).toBe("unparseable");

    for (const runtime of CLI_RUNTIMES) {
      const decision = gate.evaluate(runtime, "9.9.9");
      expect(decision.reason).toBe("ok");
      expect(decision.launchCodingTasks).toBe(true);
    }
  });

  it("fails closed when a known runtime has no signed floor", () => {
    const gate = new CliMinVersionGate([]);
    const decision = gate.evaluate("opencode", "1.2.3");
    expect(decision.status).toBe("disabled");
    expect(decision.reason).toBe("missing_floor");
    expect(decision.title).toContain("Update OpenCode to >= v");
    expect(decision.launchCodingTasks).toBe(false);
  });
});
