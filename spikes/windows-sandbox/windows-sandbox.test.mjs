import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isMxcBuildEligible } from "./src/build.mjs";
import { TIER_CAPABILITIES, assertHonestTierC } from "./src/capabilities.mjs";
import { quoteWindowsArg, quoteWindowsCommandLine, directSpawn } from "./src/spawn-direct.mjs";
import { scrubEnvironment } from "./src/env-scrub.mjs";
import { classifyPath } from "./src/volume.mjs";
import { snapshotDenyRead } from "./src/deny-read-snapshot.mjs";
import { executeInTier } from "./src/execute.mjs";
import { SandboxUnavailableError } from "./src/errors.mjs";
import { honestyProblems, notRunRows } from "./src/redteam.mjs";
import { leftoverNames } from "./src/cleanup.mjs";
import { runSpike } from "./src/spike.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("MXC build gate matches the 24H2 and 25H2 lines", () => {
  assert.equal(isMxcBuildEligible(26100, 9277), false);
  assert.equal(isMxcBuildEligible(26100, 9278), true);
  assert.equal(isMxcBuildEligible(26200, 9277), false);
  assert.equal(isMxcBuildEligible(26200, 9278), true);
  assert.equal(isMxcBuildEligible(19045, 6456), false);
  assert.equal(isMxcBuildEligible(26201, 0), true);
  assert.equal(isMxcBuildEligible(Number.NaN, 1), false);
});

test("Tier C capability descriptor stays advisory", () => {
  const tierC = assertHonestTierC(TIER_CAPABILITIES.C);
  assert.equal(tierC.networkEnforced, false);
  assert.equal(tierC.secretReadsDenied, false);
  assert.equal(tierC.fileWritesEnforced, true);
  assert.equal(tierC.network, "Advisory only (proxy environment variables)");
  assert.equal(tierC.secretReads, "Not enforced for paths the user can read");
  assert.equal(tierC.needsAdmin, "No");
  assert.equal(TIER_CAPABILITIES.A.network, "Enforced; loopback allowed");
  assert.equal(TIER_CAPABILITIES.B.needsAdmin, "Yes, once");
  assert.equal(TIER_CAPABILITIES.D.network, "Enforced; also gives Linux parity with CI");
});

test("UNC and FAT32 paths are not ACL tiers", () => {
  const unc = classifyPath("\\\\server\\share\\repo");
  assert.equal(unc.aclCapable, false);
  assert.deepEqual(unc.recommendedTiers, ["A", "D"]);
  const fat = classifyPath("E:\\repo", { fileSystem: "FAT32", driveType: "local" });
  assert.equal(fat.kind, "fat32");
  assert.equal(fat.aclCapable, false);
  const ntfs = classifyPath("C:\\repo", { fileSystem: "NTFS", driveType: "local" });
  assert.equal(ntfs.aclCapable, true);
  const network = classifyPath("Z:\\repo", { fileSystem: "NTFS", driveType: "network" });
  assert.equal(network.aclCapable, false);
});

test("environment scrub drops tokens and redirects home", () => {
  const env = scrubEnvironment({
    SystemRoot: "C:\\Windows",
    PATH: "C:\\Windows",
    GH_TOKEN: "canary-token-value",
    AWS_SECRET_ACCESS_KEY: "nope",
  }, { home: "C:\\attempt\\home", temp: "C:\\attempt\\tmp" });
  assert.equal(Object.prototype.hasOwnProperty.call(env, "GH_TOKEN"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(env, "AWS_SECRET_ACCESS_KEY"), false);
  assert.equal(env.HOME, "C:\\attempt\\home");
  assert.equal(env.USERPROFILE, "C:\\attempt\\home");
  assert.equal(env.TEMP, "C:\\attempt\\tmp");
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:9");
  assert.equal(env.SystemRoot, "C:\\Windows");
});

test("command lines are quoted without a shell", () => {
  assert.equal(quoteWindowsArg("plain"), "plain");
  assert.equal(quoteWindowsArg("C:\\Program Files\\node.exe"), '"C:\\Program Files\\node.exe"');
  assert.equal(quoteWindowsCommandLine(["node", "a b"]), 'node "a b"');
  assert.throws(() => directSpawn(process.execPath, ["-e", "0"], { shell: true }));
});

test("absent tiers throw and do not claim a blocked probe", async () => {
  const probe = { tiers: { A: { available: false, reason: "os_build_too_old" }, C: { available: false, reason: "absent" } } };
  await assert.rejects(() => executeInTier("A", { probe }), (error) => error instanceof SandboxUnavailableError && error.reason === "os_build_too_old");
  await assert.rejects(() => executeInTier("C", { probe }), (error) => error instanceof SandboxUnavailableError && error.code === "SANDBOX_UNAVAILABLE");
  const rows = notRunRows("C", "absent");
  assert.equal(honestyProblems({ C: TIER_CAPABILITIES.C, A: TIER_CAPABILITIES.A, B: TIER_CAPABILITIES.B, D: TIER_CAPABILITIES.D }, [
    ...notRunRows("A", "no"),
    ...notRunRows("B", "no"),
    ...rows,
    ...notRunRows("D", "no"),
  ]).length, 0);
  assert.equal(rows.every((row) => row.actuallyBlocked === false), true);
});

test("deny-read snapshot ignores files created after the scan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-spike-snap-"));
  try {
    fs.writeFileSync(path.join(root, "a.secret"), "a");
    const first = snapshotDenyRead(root, ".secret");
    fs.writeFileSync(path.join(root, "b.secret"), "b");
    assert.equal(first.matched.length, 1);
    assert.equal(first.matched.some((item) => item.endsWith("b.secret")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("live Windows sandbox spike", { concurrency: 1 }, () => {
  test("tier detection, job cleanup, and red-team probes", { timeout: 300000 }, async () => {
    const report = await runSpike({ fileCount: 10000, writeReport: true });
    assert.equal(report.job.close.withinBudget, true);
    assert.equal(report.job.close.orphans.length, 0);
    assert.ok(report.job.close.elapsedMs <= 1000);
    assert.equal(report.job.crash.withinBudget, true);
    assert.equal(report.job.crash.orphans.length, 0);
    assert.equal(report.tierC.ran, true);
    assert.equal(report.tierC.ghToken, false);
    assert.equal(report.tierC.canary, "read");
    assert.equal(report.tierC.outside, "EPERM");
    assert.equal(report.tierC.git, "EPERM");
    assert.notEqual(report.tierC.tcp, "EPERM");
    assert.notEqual(report.tierC.tcp, "EACCES");
    assert.equal(report.tierC.sleeperDead, true);
    assert.equal(report.hardlink.blocked, true);
    assert.equal(report.acl.fileCount, 10000);
    assert.equal(report.acl.inheritedAceVisible, true);
    assert.equal(report.tiers.C.networkEnforced, false);
    assert.equal(report.tiers.C.secretReadsDenied, false);
    assert.equal(report.tiers.A.available, false);
    assert.equal(report.cleanup.leftovers.length, 0);
    assert.equal(leftoverNames().length, 0);
    assert.equal(report.filesystem.unc.recommendedTiers.includes("B"), false);
    const tierC = report.redteam.filter((row) => row.tier === "C");
    assert.equal(tierC.length, 5);
    assert.equal(tierC.every((row) => row.detail.startsWith("not_run")), false);
    assert.equal(tierC.find((row) => row.testId === "read-secret")?.actuallyBlocked, false);
    assert.equal(tierC.find((row) => row.testId === "raw-tcp")?.actuallyBlocked, false);
    assert.equal(tierC.find((row) => row.testId === "write-outside")?.actuallyBlocked, true);
  });
});
