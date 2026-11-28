import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConformanceAbortedError } from "../../src/conformance/errors.js";
import {
  CANARY_MARKER,
  CREDENTIAL_MARKER,
  FOREIGN_ADAPTERS,
  HARNESS_CONFORMANCE_SUITE_VERSION,
  PROBE_IDS,
  compliantBehavior,
  createConformanceStack,
  exportScorecard,
  rogueBehavior,
  runConformanceCli,
} from "../../src/conformance/index.js";
import type { AdapterBehavior, ConformanceReport, ProbeId } from "../../src/conformance/index.js";

const HOOK_MESSAGE = "Codex v2.3.0 broke native permission hooks — switched safely to Stripped mode";
const PROCESS_MESSAGE =
  "Cursor v2.6.0 leaked a child process outside the Job Object — switched safely to Stripped mode";

function probe(report: ConformanceReport, id: ProbeId, source: "final" | "wrapped" = "final") {
  const list = source === "final" ? report.probes : report.attempted.wrapped;
  const found = list.find((item) => item.probeId === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("adapter conformance gauntlet", () => {
  it(
    "passes 10/10 on all 7 adapters and downgrades rogue adapters",
    async () => {
      const result = await runConformanceCli();
      expect(result.exitCode).toBe(0);
      expect(result.matrix.allTenOfTen).toBe(true);
      expect(result.matrix.reports.map((report) => report.adapterId)).toEqual(
        FOREIGN_ADAPTERS.map((profile) => profile.adapterId),
      );
      expect(result.matrix.reports.every((report) => report.durationMs < 3_000)).toBe(true);
      expect(result.matrix.durationMs).toBeLessThan(45_000);
      for (const report of result.matrix.reports) {
        expect(report.probes.map((item) => item.probeId)).toEqual([...PROBE_IDS]);
        expect(report.cleanup.scratchRemoved).toBe(true);
        expect(report.cleanup.canaryRemoved).toBe(true);
        expect(report.cleanup.trapClosed).toBe(true);
        expect(report.cleanup.leftoverPids).toBe(0);
        expect(JSON.stringify(report)).not.toContain(CANARY_MARKER);
        expect(JSON.stringify(report)).not.toContain(CREDENTIAL_MARKER);
      }

      const write = result.rogues.stripped.find((report) => report.adapterId === "rogue-p02");
      const canary = result.rogues.stripped.find((report) => report.adapterId === "rogue-p05");
      const network = result.rogues.stripped.find((report) => report.adapterId === "rogue-p06");
      const process = result.rogues.stripped.find((report) => report.adapterId === "rogue-p07");
      expect(write?.notification).toBe(HOOK_MESSAGE);
      expect(probe(write as ConformanceReport, "P02", "wrapped").status).toBe("fail");
      expect(probe(write as ConformanceReport, "P02").status).toBe("pass");
      expect(probe(canary as ConformanceReport, "P05", "wrapped").status).toBe("fail");
      expect(probe(canary as ConformanceReport, "P05").status).toBe("pass");
      expect(probe(network as ConformanceReport, "P06", "wrapped").status).toBe("fail");
      expect(network?.forensics.some((item) => item.evidence.network_exfil_detected === 1)).toBe(true);
      expect(probe(network as ConformanceReport, "P06").status).toBe("pass");
      expect(process?.notification).toBe(PROCESS_MESSAGE);
      expect(probe(process as ConformanceReport, "P07", "wrapped").status).toBe("fail");
      expect(process?.forensics.some((item) => item.probeId === "P07" && Number(item.evidence.survivingPids) >= 1)).toBe(
        true,
      );

      for (const report of result.rogues.disabled) {
        expect(report.trust).toBe("disabled");
        expect(report.mode).toBe("stripped");
        expect(probe(report, report.adapterId.includes("p02") ? "P02" : report.adapterId.includes("p05") ? "P05" : report.adapterId.includes("p06") ? "P06" : "P07").status).toBe(
          "fail",
        );
      }
      const leakedCanary = result.rogues.disabled.find((report) => report.adapterId === "rogue-p05-disabled");
      expect(leakedCanary?.trust).toBe("disabled");
      expect(JSON.stringify(leakedCanary)).not.toContain(CANARY_MARKER);
    },
    60_000,
  );
});

describe("conformance verdicts", () => {
  it("keeps conformance when native resume fails and the labeled WIP fallback works", async () => {
    const { runner, registry } = createConformanceStack();
    const behavior: AdapterBehavior = {
      ...compliantBehavior(FOREIGN_ADAPTERS[1] as (typeof FOREIGN_ADAPTERS)[number]),
      adapterId: "codex-no-native",
      nativeResumeWorks: false,
    };
    const report = await runner.run({
      behavior,
      trigger: "first_enable",
      driver: "synthetic",
      sandboxTier: "A",
    });
    expect(probe(report, "P09").status).toBe("pass");
    expect(probe(report, "P09").diagnostic).toContain("labeled WIP");
    expect(report.nativeResumeSupported).toBe(false);
    expect(report.trust).toBe("conformance_verified");
    expect(report.mode).toBe("wrapped");
    expect(registry.assignCodingTask("codex-no-native").mode).toBe("wrapped");
  }, 20_000);

  it("does not verify an adapter whose resume fallback also fails", async () => {
    const { runner, registry } = createConformanceStack();
    const behavior: AdapterBehavior = {
      ...compliantBehavior(FOREIGN_ADAPTERS[0] as (typeof FOREIGN_ADAPTERS)[number]),
      adapterId: "acp-no-resume",
      nativeResumeWorks: false,
      resumeFallbackFails: true,
    };
    const report = await runner.run({
      behavior,
      trigger: "first_enable",
      driver: "synthetic",
      sandboxTier: "B",
    });
    expect(probe(report, "P09").status).toBe("fail");
    expect(report.trust).toBe("observe_only");
    expect(() => registry.assignCodingTask("acp-no-resume")).toThrow(/cannot receive coding tasks/);
  }, 20_000);

  it("accepts quota-only usage and rejects an empty receipt", async () => {
    const { runner } = createConformanceStack();
    const base = compliantBehavior(FOREIGN_ADAPTERS[4] as (typeof FOREIGN_ADAPTERS)[number]);
    const quota = await runner.run({
      behavior: {
        ...base,
        adapterId: "claude-quota",
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, quotaUnits: 7 },
      },
      trigger: "first_enable",
      driver: "synthetic",
      sandboxTier: "A",
    });
    expect(probe(quota, "P10").status).toBe("pass");
    const empty = await runner.run({
      behavior: {
        ...base,
        adapterId: "claude-empty-usage",
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 },
      },
      trigger: "first_enable",
      driver: "synthetic",
      sandboxTier: "A",
    });
    expect(probe(empty, "P10").status).toBe("fail");
    expect(empty.trust).toBe("observe_only");
  }, 20_000);

  it("rejects a CLI below the minimum version and limits a read-only escape to observe_only", async () => {
    const { runner, registry } = createConformanceStack();
    const base = compliantBehavior(FOREIGN_ADAPTERS[6] as (typeof FOREIGN_ADAPTERS)[number]);
    const old = await runner.run({
      behavior: { ...base, adapterId: "opencode-old", cliVersion: "0.0.0" },
      trigger: "first_enable",
      driver: "synthetic",
      sandboxTier: "C",
    });
    expect(probe(old, "P01").status).toBe("fail");
    expect(old.trust).toBe("observe_only");
    const observe = await runner.run({
      behavior: rogueBehavior({
        adapterId: "rogue-observe",
        displayName: "OpenCode",
        cliVersion: "3.4.0",
        violation: "P05",
        escapesStrippedSandbox: true,
        readOnlyInspectionOnly: true,
      }),
      trigger: "explicit_check",
      driver: "synthetic",
      sandboxTier: "A",
    });
    expect(observe.trust).toBe("observe_only");
    expect(observe.notification).toContain("observe only");
    expect(registry.trustOf("rogue-observe")).toBe("observe_only");
    const card = exportScorecard(observe, "settings_connections");
    const diagnostics = exportScorecard(observe, "diagnostics");
    expect(card.probes[0]).toEqual({
      probeId: card.probes[0]?.probeId,
      name: card.probes[0]?.name,
      status: card.probes[0]?.status,
      durationMs: card.probes[0]?.durationMs,
      diagnostic: card.probes[0]?.diagnostic,
    });
    expect(diagnostics.surface).toBe("diagnostics");
    expect(card.surface).toBe("settings_connections");
  }, 20_000);
});

describe("conformance cache", () => {
  it("returns a startup hit in under 2 ms and misses when version, tier, or signature changes", async () => {
    const { runner, cache, db } = createConformanceStack();
    const behavior = compliantBehavior(FOREIGN_ADAPTERS[2] as (typeof FOREIGN_ADAPTERS)[number]);
    let runs = 0;
    const first = await runner.run({
      behavior,
      trigger: "first_enable",
      driver: "synthetic",
      sandboxTier: "A",
      onScratchReady: () => {
        runs += 1;
      },
    });
    expect(first.probesExecuted).toBe(true);
    expect(first.trust).toBe("conformance_verified");

    const cached = await runner.run({
      behavior,
      trigger: "startup",
      driver: "synthetic",
      sandboxTier: "A",
      onScratchReady: () => {
        runs += 1;
      },
    });
    expect(cached.cacheHit).toBe(true);
    expect(cached.probesExecuted).toBe(false);
    expect(cached.durationMs).toBeLessThan(2);
    expect(runs).toBe(1);

    const retier = await runner.run({
      behavior,
      trigger: "startup",
      driver: "synthetic",
      sandboxTier: "B",
      onScratchReady: () => {
        runs += 1;
      },
    });
    expect(retier.cacheHit).toBe(false);
    expect(retier.sandboxTier).toBe("B");
    expect(runs).toBe(2);

    const upgraded = await runner.run({
      behavior: { ...behavior, cliVersion: "9.9.1" },
      trigger: "startup",
      driver: "synthetic",
      sandboxTier: "A",
      onScratchReady: () => {
        runs += 1;
      },
    });
    expect(upgraded.probesExecuted).toBe(true);
    expect(runs).toBe(3);

    const again = await runner.run({
      behavior,
      trigger: "explicit_check",
      driver: "synthetic",
      sandboxTier: "A",
      onScratchReady: () => {
        runs += 1;
      },
    });
    expect(again.cacheHit).toBe(false);
    expect(runs).toBe(4);

    const key = {
      adapterId: behavior.adapterId,
      cliVersion: behavior.cliVersion,
      sandboxTier: "A" as const,
      harnessConformanceSuiteVersion: HARNESS_CONFORMANCE_SUITE_VERSION,
    };
    expect(cache.lookup({ ...key, harnessConformanceSuiteVersion: "0.0.0" })).toBeNull();
    cache.dropMemory();
    db.rewriteSignature(key, "00");
    expect(cache.lookup(key)).toBeNull();
    const rerun = await runner.run({
      behavior,
      trigger: "startup",
      driver: "synthetic",
      sandboxTier: "A",
    });
    expect(rerun.probesExecuted).toBe(true);
  }, 30_000);
});

describe("conformance cleanup and live mode", () => {
  it("deletes the scratch worktree, canary, and trap when the run is cancelled", async () => {
    const { runner } = createConformanceStack();
    let root = "";
    let canary = "";
    let port = 0;
    const realSsh = path.resolve(path.join(os.homedir(), ".ssh"));
    await expect(
      runner.run({
        behavior: compliantBehavior(FOREIGN_ADAPTERS[3] as (typeof FOREIGN_ADAPTERS)[number]),
        trigger: "explicit_check",
        driver: "synthetic",
        sandboxTier: "D",
        abortAfter: "P02",
        onScratchReady: (paths) => {
          root = paths.root;
          canary = paths.canaryPath;
          port = paths.trapPort;
          expect(root.startsWith(os.tmpdir())).toBe(true);
          expect(path.resolve(canary).startsWith(realSsh)).toBe(false);
          expect(existsSync(root)).toBe(true);
          const sha = execFileSync("git", ["-c", "safe.directory=*", "-C", root, "rev-parse", "HEAD"], {
            encoding: "utf8",
            windowsHide: true,
          }).trim();
          const kind = execFileSync("git", ["-c", "safe.directory=*", "-C", root, "cat-file", "-t", "HEAD"], {
            encoding: "utf8",
            windowsHide: true,
          }).trim();
          expect(sha).toMatch(/^[0-9a-f]{40}$/);
          expect(kind).toBe("commit");
        },
      }),
    ).rejects.toBeInstanceOf(ConformanceAbortedError);
    expect(existsSync(root)).toBe(false);
    expect(existsSync(canary)).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/exfil`)).rejects.toThrow();
  }, 20_000);

  it("cleans up when a probe crashes", async () => {
    const { runner } = createConformanceStack();
    let root = "";
    await expect(
      runner.run({
        behavior: { ...compliantBehavior(FOREIGN_ADAPTERS[5] as (typeof FOREIGN_ADAPTERS)[number]), adapterId: "gemini-crash" },
        trigger: "first_enable",
        driver: "synthetic",
        sandboxTier: "A",
        crashAt: "P04",
        onScratchReady: (paths) => {
          root = paths.root;
        },
      }),
    ).rejects.toThrow(/crashed at P04/);
    expect(existsSync(root)).toBe(false);
  }, 20_000);

  it("runs the live double through all 10 probes and skips a missing binary", async () => {
    const { runner } = createConformanceStack();
    const doublePath = fileURLToPath(new URL("./live-double.mjs", import.meta.url));
    const live = await runner.run({
      behavior: {
        ...compliantBehavior(FOREIGN_ADAPTERS[0] as (typeof FOREIGN_ADAPTERS)[number]),
        adapterId: "acp-live",
        cliVersion: "2.0.0",
      },
      trigger: "first_enable",
      driver: "live",
      sandboxTier: "A",
      liveCommand: process.execPath,
      liveArgs: [doublePath],
    });
    expect(live.probes.every((item) => item.status === "pass")).toBe(true);
    expect(JSON.stringify(live)).not.toContain(CREDENTIAL_MARKER);
    const missing = await runner.run({
      behavior: {
        ...compliantBehavior(FOREIGN_ADAPTERS[0] as (typeof FOREIGN_ADAPTERS)[number]),
        adapterId: "acp-missing",
      },
      trigger: "first_enable",
      driver: "live",
      sandboxTier: "A",
      liveCommand: path.join(os.tmpdir(), "ef-missing-conformance-cli.exe"),
    });
    expect(probe(missing, "P01").status).toBe("fail");
    expect(probe(missing, "P02").status).toBe("skipped");
    expect(missing.trust).toBe("observe_only");
    expect(missing.cleanup.scratchRemoved).toBe(true);
    expect(missing.cleanup.trapClosed).toBe(true);
  }, 30_000);
});
