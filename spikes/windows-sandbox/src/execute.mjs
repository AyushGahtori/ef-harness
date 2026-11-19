import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SandboxUnavailableError } from "./errors.mjs";
import { TIER_CAPABILITIES, assertHonestTierC } from "./capabilities.mjs";
import { scrubEnvironment, environmentPairs } from "./env-scrub.mjs";
import { quoteWindowsCommandLine } from "./spawn-direct.mjs";
import { versionArgv } from "./host.mjs";
import { isPidAlive, stopPid, waitUntilDead } from "./cleanup.mjs";

const childActionSource = fileURLToPath(new URL("../child-action.mjs", import.meta.url));

export function tierAExecutionReason(mxc) {
  if (!mxc.buildEligible) return "os_build_too_old";
  if (!mxc.exportPresent) return "mxc_export_missing";
  return "mxc_requires_pinned_helper";
}

/**
 * @param {"A" | "B" | "C" | "D"} tier
 * @param {{ probe?: { tiers?: Record<string, { available?: boolean, reason?: string }> }, markerPath?: string }} request
 */
export async function executeInTier(tier, request = {}) {
  const probe = request.probe;
  if (!probe || !probe.tiers) {
    throw new SandboxUnavailableError(tier, "probe_required", null);
  }
  const row = probe.tiers[tier];
  if (!row?.available) {
    throw new SandboxUnavailableError(tier, row?.reason || "tier_absent", row ?? null);
  }
  if (tier !== "C") {
    throw new SandboxUnavailableError(tier, "launcher_not_linked", row);
  }
  return runTierC(request.helper, request.spec);
}

/**
 * @param {{ request: Function }} helper
 * @param {Record<string, any>} spec
 */
export async function runTierC(helper, spec) {
  const source = { ...process.env, GH_TOKEN: "canary-token-value" };
  const env = scrubEnvironment(source, { home: spec.home, temp: spec.temp });
  if (Object.prototype.hasOwnProperty.call(env, "GH_TOKEN")) {
    throw new Error("scrubbed environment still contains GH_TOKEN");
  }
  const argv = [process.execPath, spec.script, "redteam", spec.resultPath, spec.specPath];
  const response = await helper.request({
    op: "spawn-restricted",
    id: spec.id || "tier-c",
    application: process.execPath,
    commandLine: quoteWindowsCommandLine(argv),
    cwd: spec.cwd,
    env: environmentPairs(env),
    grantDirs: spec.grantDirs,
    denyDirs: spec.denyDirs,
    denyFiles: spec.denyFiles,
    timeoutMs: spec.timeoutMs || 30000,
  }, (spec.timeoutMs || 30000) + 10000);
  if (!response.ok) {
    throw new SandboxUnavailableError("C", response.reason || "launch_failed", response);
  }
  return response;
}

export function prepareTierCWorkspace(root) {
  const work = path.join(root, "work");
  const home = path.join(work, "home");
  const temp = path.join(work, "tmp");
  const git = path.join(work, ".git");
  const store = path.join(root, "pnpm-store", "pkg.txt");
  const hardlink = path.join(work, "node_modules", "pkg.txt");
  const canaryDir = path.join(root, "canary-secrets");
  const canary = path.join(canaryDir, "id_ed25519");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(temp, { recursive: true });
  fs.mkdirSync(git, { recursive: true });
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.mkdirSync(path.dirname(hardlink), { recursive: true });
  fs.mkdirSync(canaryDir, { recursive: true });
  fs.writeFileSync(path.join(git, "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(store, "shared-store\n");
  fs.linkSync(store, hardlink);
  fs.writeFileSync(canary, "CANARY_NOT_A_KEY\n");
  const script = path.join(work, "child-action.mjs");
  fs.copyFileSync(childActionSource, script);
  const specPath = path.join(work, "spec.json");
  const resultPath = path.join(work, "result.json");
  const sleeperPid = path.join(work, "sleeper.pid");
  const toolDir = path.join(work, "tool-output");
  fs.mkdirSync(toolDir, { recursive: true });
  const tools = ["node", "git", "pnpm"].map((name) => {
    const argv = versionArgv(name);
    if (!argv) return null;
    return {
      name,
      argv,
      stdoutPath: path.join(toolDir, `${name}.out.txt`),
      stderrPath: path.join(toolDir, `${name}.err.txt`),
    };
  }).filter((tool) => tool);
  const spec = {
    canary,
    inside: path.join(work, "inside.txt"),
    tempFile: path.join(temp, "temp.txt"),
    outside: path.join(root, "outside.txt"),
    head: path.join(git, "HEAD"),
    hardlink,
    host: "1.1.1.1",
    port: 443,
    sleeperPid,
    tools,
  };
  fs.writeFileSync(specPath, JSON.stringify(spec));
  return {
    id: "tier-c-redteam",
    cwd: work,
    home,
    temp,
    grantDirs: [work],
    denyDirs: [git],
    denyFiles: [store],
    script,
    specPath,
    resultPath,
    sleeperPid,
    spec,
    store,
    timeoutMs: 30000,
  };
}

export async function executeTierC(helper, prepared) {
  const launched = await runTierC(helper, prepared);
  const raw = fs.existsSync(prepared.resultPath) ? JSON.parse(fs.readFileSync(prepared.resultPath, "utf8")) : null;
  let sleeperDead = null;
  if (raw && Number.isInteger(raw.sleeperPid)) {
    const waited = await waitUntilDead([raw.sleeperPid], 1000);
    sleeperDead = { ...waited, pid: raw.sleeperPid, aliveAtCheck: isPidAlive(raw.sleeperPid) };
    stopPid(raw.sleeperPid);
  }
  let hostWriteAfter = false;
  try {
    fs.writeFileSync(prepared.store, "host-still-can-write\n");
    hostWriteAfter = true;
  } catch (error) {
    hostWriteAfter = false;
    prepared.hostWriteError = error && error.code ? error.code : "ERROR";
  }
  return { launched, raw, sleeperDead, hostWriteAfter, capabilities: assertHonestTierC(TIER_CAPABILITIES.C) };
}
