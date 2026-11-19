import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TIER_CAPABILITIES, assertHonestTierC } from "./capabilities.mjs";
import { classifyPath } from "./volume.mjs";
import { benchmarkAclInheritance, proveHardlinkAcl } from "./acl.mjs";
import { snapshotDenyRead } from "./deny-read-snapshot.mjs";
import { proveJobTermination } from "./job-object.mjs";
import { executeInTier, executeTierC, prepareTierCWorkspace, tierAExecutionReason } from "./execute.mjs";
import { honestyProblems, notRunRows, tierCRows } from "./redteam.mjs";
import { readWindowsBuild, probeDocker, probeWsl } from "./host.mjs";
import { startWin32Helper } from "./helper-client.mjs";
import { SandboxUnavailableError } from "./errors.mjs";
import { leftoverNames, makeScratch, removeTree, sweepLeftovers } from "./cleanup.mjs";
import { renderReport } from "./report.mjs";

const spikeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function refusal(tier, probe) {
  try {
    await executeInTier(tier, { probe });
    return { tier, threw: false, name: null, reason: null };
  } catch (error) {
    return {
      tier,
      threw: error instanceof SandboxUnavailableError,
      name: error instanceof Error ? error.name : "Error",
      reason: error instanceof SandboxUnavailableError ? error.reason : null,
    };
  }
}

/**
 * @param {{ fileCount?: number, allowElevatedTierB?: boolean, writeReport?: boolean, reportDir?: string }} [options]
 */
export async function runSpike(options = {}) {
  const fileCount = options.fileCount ?? 10000;
  const allowElevatedTierB = options.allowElevatedTierB === true;
  sweepLeftovers();
  const helper = startWin32Helper();
  const crashHelper = startWin32Helper();
  /** @type {string[]} */
  const trees = [];
  try {
    const build = readWindowsBuild();
    const mxcRaw = await helper.request({ op: "probe-mxc", id: "mxc" });
    const elevation = await helper.request({ op: "probe-elevation", id: "elevation" });
    const desktop = await helper.request({ op: "probe-desktop", id: "desktop" });
    const token = await helper.request({ op: "probe-token", id: "token" });
    const users = await helper.request({ op: "users", id: "users" });
    const volume = await helper.request({ op: "volume", id: "volume", path: process.cwd() });
    const docker = probeDocker();
    const wsl = probeWsl();
    const mxc = {
      buildEligible: build.eligible === true,
      osBuild: build.text,
      buildNumber: build.buildNumber,
      revision: build.revision,
      filePresent: mxcRaw.filePresent === true,
      loaded: mxcRaw.loaded === true,
      exportPresent: mxcRaw.exportPresent === true,
      launcherLinked: false,
      detail: mxcRaw.ok ? mxcRaw.detail : mxcRaw.detail || mxcRaw.reason,
      documentedChildTermination: "Remaining child processes stop when the foreground command exits.",
      documentedDenyReadTiming: "Deny-read globs use the files that match when each sandboxed process starts. A file created later is not in that snapshot.",
      empiricalChildTermination: null,
      empiricalDenyReadTiming: null,
    };
    mxc.reason = tierAExecutionReason(mxc);
    const usersReady = users.ok === true && users.offline === true && users.online === true;
    const tierBSetup = usersReady ? "provisioned" : "requires one-time admin consent";
    const tierCAvailable = token.ok === true && token.supported === true;
    const wslUsable = wsl.installed === true && Array.isArray(wsl.distros) && wsl.distros.length > 0;
    const containerPresent = docker.running === true || wslUsable;
    let tierDReason = "docker_and_wsl_unavailable";
    if (containerPresent) tierDReason = "container_present_but_not_launched_by_this_spike";
    else if (docker.installed === true && docker.running !== true) tierDReason = docker.reason || "daemon_not_running";
    else if (wsl.installed === true && !wslUsable) tierDReason = "wsl_installed_no_distro";
    const tiers = {
      A: { ...TIER_CAPABILITIES.A, available: false, reason: mxc.reason },
      B: {
        ...TIER_CAPABILITIES.B,
        available: false,
        reason: allowElevatedTierB
          ? "elevated Tier B launch is still not performed by this spike; firewall rules were not changed"
          : tierBSetup,
        setup: tierBSetup,
      },
      C: {
        ...assertHonestTierC({ ...TIER_CAPABILITIES.C }),
        available: tierCAvailable,
        reason: tierCAvailable ? "write_restricted_token" : (token.detail || token.reason || "restricted_token_unavailable"),
      },
      D: {
        ...TIER_CAPABILITIES.D,
        available: false,
        reason: tierDReason,
      },
    };
    const probe = { tiers };
    const refusals = [];
    for (const tier of ["A", "B", "D"]) {
      const result = await refusal(tier, probe);
      if (!result.threw) throw new Error(`Tier ${tier} executed without a sandbox`);
      refusals.push(result);
    }
    const absent = await refusal("C", { tiers: { C: { available: false, reason: "absent" } } });
    if (!absent.threw) throw new Error("an absent Tier C executed without a sandbox");

    const jobClose = await proveJobTermination(helper, "close");
    if (!jobClose.withinBudget) throw new Error(`job close left orphans ${jobClose.orphans.join(",")} after ${jobClose.elapsedMs}ms`);
    const jobCrash = await proveJobTermination(crashHelper, "crash");
    if (!jobCrash.withinBudget) throw new Error(`job crash left orphans ${jobCrash.orphans.join(",")} after ${jobCrash.elapsedMs}ms`);

    const snapshotRoot = makeScratch();
    trees.push(snapshotRoot);
    fs.mkdirSync(path.join(snapshotRoot, "sub"));
    const early = path.join(snapshotRoot, "early.secret");
    fs.writeFileSync(early, "early");
    const snapshot = snapshotDenyRead(snapshotRoot, ".secret");
    const later = path.join(snapshotRoot, "sub", "later.secret");
    fs.writeFileSync(later, "later");
    const denyReadSnapshot = {
      matchedEarly: snapshot.matched.some((item) => item.endsWith("early.secret")),
      laterFileWasOutsideSnapshot: !snapshot.matched.some((item) => item.endsWith("later.secret")),
    };
    if (!denyReadSnapshot.matchedEarly || !denyReadSnapshot.laterFileWasOutsideSnapshot) {
      throw new Error("deny-read snapshot did not freeze the start-time matches");
    }

    let tierC = { ran: false, reason: tiers.C.reason };
    /** @type {ReturnType<typeof notRunRows>[]} */
    let redteam = [
      ...notRunRows("A", tiers.A.reason),
      ...notRunRows("B", tiers.B.reason),
      ...notRunRows("D", tiers.D.reason),
    ];
    if (!tierCAvailable) {
      redteam = [...redteam.slice(0, 10), ...notRunRows("C", tiers.C.reason), ...redteam.slice(10)];
    } else {
      const tierRoot = makeScratch();
      trees.push(tierRoot);
      const prepared = prepareTierCWorkspace(tierRoot);
      const executed = await executeTierC(helper, prepared);
      if (!executed.raw) throw new Error(`Tier C produced no result. exit=${executed.launched.exitCode} stderr=${helper.stderr()}`);
      const raw = executed.raw;
      if (!raw.inside?.ok) throw new Error(`Tier C could not write the worktree (${raw.inside?.code})`);
      if (!raw.temp?.ok) throw new Error(`Tier C could not write the attempt temp (${raw.temp?.code})`);
      if (raw.env?.ghToken !== false) throw new Error("Tier C environment still had GH_TOKEN");
      if (raw.env?.home !== prepared.home) throw new Error(`Tier C HOME was ${raw.env?.home}`);
      if (raw.env?.temp !== prepared.temp) throw new Error(`Tier C TEMP was ${raw.env?.temp}`);
      if (!String(raw.env?.httpProxy || "").includes("127.0.0.1:9")) throw new Error("Tier C proxy was not the advisory sink");
      if (raw.read?.code === "REFUSED_REAL_SSH") throw new Error("Tier C target resolved to a real .ssh path");
      if (!raw.read?.ok) throw new Error(`Tier C unexpectedly failed to read the canary (${raw.read?.code})`);
      if (!hardlinkSameBlocked(raw.hardlink)) throw new Error(`Tier C hard link write code ${raw.hardlink?.code}`);
      if (!executed.hostWriteAfter) throw new Error("sandbox ACE was still blocking the owner after cleanup");
      const rows = tierCRows(raw, executed.launched.exitCode ?? null, executed.sleeperDead);
      redteam = [...redteam.slice(0, 10), ...rows, ...redteam.slice(10)];
      tierC = {
        ran: true,
        reason: "write_restricted_token",
        launchApi: executed.launched.launchApi,
        exitCode: executed.launched.exitCode,
        inside: raw.inside?.ok ? "wrote" : raw.inside?.code,
        temp: raw.temp?.ok ? "wrote" : raw.temp?.code,
        outside: raw.outside?.code || (raw.outside?.ok ? "wrote" : "unknown"),
        git: raw.git?.code || (raw.git?.ok ? "wrote" : "unknown"),
        canary: raw.read?.ok ? "read" : raw.read?.code,
        tcp: raw.tcp?.code || "unknown",
        home: raw.env?.home,
        ghToken: raw.env?.ghToken,
        httpProxy: raw.env?.httpProxy,
        hardlink: raw.hardlink?.code || (raw.hardlink?.ok ? "wrote" : "unknown"),
        hostWriteAfter: executed.hostWriteAfter,
        sleeperDead: Boolean(executed.sleeperDead && executed.sleeperDead.alive.length === 0),
        tools: raw.tools || {},
      };
    }
    const aclRoot = makeScratch();
    trees.push(aclRoot);
    const acl = await benchmarkAclInheritance(path.join(aclRoot, "bench"), fileCount, helper);
    const hardlink = proveHardlinkAcl(path.join(aclRoot, "link"));
    if (!hardlink.blocked) throw new Error(`hard link write was not denied (${hardlink.writeCode})`);
    const ordered = [];
    for (const tier of ["A", "B", "C", "D"]) {
      for (const row of redteam.filter((item) => item.tier === tier)) ordered.push(row);
    }
    const problems = honestyProblems(tiers, ordered);
    if (problems.length > 0) throw new Error(problems.join("; "));

    const workspace = classifyPath(process.cwd(), {
      fileSystem: volume.fileSystem,
      driveType: volume.driveType,
    });
    const report = {
      generatedAt: new Date().toISOString(),
      host: {
        osBuild: build.text,
        buildNumber: build.buildNumber,
        revision: build.revision,
        adminGroup: elevation.adminGroup === true,
        elevated: elevation.elevated === true,
      },
      mxc,
      tiers,
      tierB: {
        offline: users.offline === true,
        online: users.online === true,
        setup: tierBSetup,
        firewallChanged: false,
        allowElevatedTierB,
      },
      tierC,
      docker,
      wsl,
      acl,
      hardlink,
      job: { close: jobClose, crash: jobCrash },
      denyReadSnapshot,
      redteam: ordered,
      filesystem: {
        workspace: { path: process.cwd(), ...workspace },
        unc: classifyPath("\\\\server\\share\\project"),
        fat32: classifyPath("D:\\project", { fileSystem: "FAT32", driveType: "local" }),
      },
      desktop: {
        createDesktop: desktop.createDesktop === true,
        sendInputIsolated: false,
        win32: desktop.win32 ?? null,
        detail: desktop.detail || desktop.reason || "",
      },
      appContainer: { selected: false },
      refusals,
      cleanup: { leftovers: [] },
    };
    for (const tree of trees) removeTree(tree);
    trees.length = 0;
    report.cleanup.leftovers = leftoverNames();
    if (report.cleanup.leftovers.length > 0) {
      throw new Error(`scratch leftovers: ${report.cleanup.leftovers.join(", ")}`);
    }
    if (options.writeReport) {
      const directory = options.reportDir || spikeDir;
      fs.writeFileSync(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      fs.writeFileSync(path.join(directory, "REPORT.md"), renderReport(report));
    }
    return report;
  } finally {
    for (const tree of trees) removeTree(tree);
    await crashHelper.close();
    await helper.close();
    sweepLeftovers();
  }
}

function hardlinkSameBlocked(attempt) {
  return Boolean(attempt && attempt.ok === false && (attempt.code === "EPERM" || attempt.code === "EACCES"));
}
