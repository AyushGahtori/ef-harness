import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { compareSemver, probeOpenCodeBinary } from "../../src/opencode/index.js";
import type { CommandRunner } from "../../src/opencode/index.js";

const fake = fileURLToPath(new URL("./fake-opencode-acp.mjs", import.meta.url));

function runner(version: string, acp = true): CommandRunner {
  return {
    run(_binary, args) {
      if (args[0] === "--version") return { status: 0, stdout: `opencode ${version}\n`, stderr: "" };
      if (!acp) return { status: 1, stdout: "", stderr: "unknown command" };
      return { status: 0, stdout: "opencode acp\n", stderr: "" };
    },
  };
}

describe("CliMinVersionGate probe", () => {
  it("compares semver and registers a current acp build as conformance_verified", () => {
    expect(compareSemver("1.2.3", "1.0.0")).toBe(1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("0.9.9", "1.0.0")).toBe(-1);
    const probed = probeOpenCodeBinary("opencode", { minVersion: "1.0.0", denylist: [] }, runner("1.2.3"));
    expect(probed.trust).toBe("conformance_verified");
    expect(probed.supportsAcp).toBe(true);
    expect(probed.version).toBe("1.2.3");
  });

  it("blocks old, denylisted, and acp-incapable binaries", () => {
    const old = probeOpenCodeBinary("opencode", { minVersion: "1.0.0", denylist: [] }, runner("0.1.0"));
    expect(old.trust).toBe("disabled");
    expect(old.message).toBe("Update opencode to >= 1.0.0");
    const denied = probeOpenCodeBinary("opencode", { minVersion: "1.0.0", denylist: ["1.2.3"] }, runner("1.2.3"));
    expect(denied.trust).toBe("disabled");
    expect(denied.message).toContain("denylisted");
    const noAcp = probeOpenCodeBinary("opencode", { minVersion: "1.0.0", denylist: [] }, runner("1.2.3", false));
    expect(noAcp.supportsAcp).toBe(false);
    expect(noAcp.trust).toBe("disabled");
    const missing = probeOpenCodeBinary(
      "opencode",
      { minVersion: "1.0.0", denylist: [] },
      { run: () => ({ status: null, stdout: "", stderr: "not found" }) },
    );
    expect(missing.installed).toBe(false);
    expect(missing.trust).toBe("disabled");
  });

  it("probes the fake opencode binary for version and acp help", () => {
    const probed = probeOpenCodeBinary(fake);
    expect(probed.trust).toBe("conformance_verified");
    expect(probed.version).toBe("1.2.3");
    expect(probed.supportsAcp).toBe(true);
  });
});
