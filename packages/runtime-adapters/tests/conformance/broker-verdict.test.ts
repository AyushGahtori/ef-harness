import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GlobalBrokerDb } from "@ef-harness/db";
import { assertAgentRuntimeAdapter } from "../../src/core/interface.js";
import { HARNESS_CONFORMANCE_SUITE_VERSION, compliantBehavior, createConformanceStack, FOREIGN_ADAPTERS } from "../../src/conformance/index.js";
import { runtimeAdapterModules } from "../../src/index.js";

describe("conformance verdicts in GlobalBrokerDb", () => {
  it("keeps a version-keyed verdict across reopen", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ef-conformance-broker-"));
    const behavior = compliantBehavior(FOREIGN_ADAPTERS[0] as (typeof FOREIGN_ADAPTERS)[number]);
    const first = createConformanceStack({ root });
    const report = await first.runner.run({
      behavior,
      trigger: "first_enable",
      driver: "synthetic",
      sandboxTier: "A",
    });
    expect(report.probes.every((probe) => probe.status === "pass")).toBe(true);
    first.close();

    const reopened = GlobalBrokerDb.open({ root });
    try {
      const row = reopened.findActiveAdapterConformance({
        adapterId: behavior.adapterId,
        cliVersion: behavior.cliVersion,
        osSandboxTier: "A",
        suiteVersion: HARNESS_CONFORMANCE_SUITE_VERSION,
      });
      expect(row?.trust).toBe("conformance_verified");
      expect(row?.signature.length).toBeGreaterThan(10);
      const stored = JSON.parse(row?.reportJson ?? "{}") as { signature?: string };
      expect(stored.signature).toBe(row?.signature);
    } finally {
      reopened.close();
    }
  }, 20_000);

  it("exports every runtime adapter module from the package barrel", () => {
    expect(Object.keys(runtimeAdapterModules).sort()).toEqual(
      ["acp", "claude-code", "codex", "conformance", "copilot", "core", "cursor", "gemini-cli", "opencode", "resume"].sort(),
    );
    assertAgentRuntimeAdapter(new runtimeAdapterModules.acp.GenericAcpAdapter());
  });
});
