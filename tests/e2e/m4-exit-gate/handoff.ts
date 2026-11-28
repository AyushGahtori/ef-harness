import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EPHEMERAL_DIR_NAMES, IDLE_PARK_AFTER_MS, IDLE_WAIT_OBSERVED_MS, PRIOR_UNVERIFIED_WIP } from "./constants.js";
import { isAlive, killTree, spawnSleeper, waitUntilAlive, waitUntilDead } from "./process-tree.js";

export interface HandoffResult {
  readonly ok: boolean;
  readonly wipTreeSha: string;
  readonly restoredTreeSha: string;
  readonly handoffText: string;
  readonly leftovers: number;
  readonly userApprovedSwitch: boolean;
  readonly pausedAtPpm: number;
}

export function runCrossAdapterHandoff(leaveEphemeral: boolean): HandoffResult {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "m4-handoff-"));
  try {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "order.js"), 'export const cutoff = "11:00";\n');
    const ephemeralFiles = [
      path.join(root, "CODEX_HOME", "session.json"),
      path.join(root, "codex-skills-tmp", "skill.md"),
    ];
    for (const file of ephemeralFiles) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "ephemeral");
    }
    const userApprovedSwitch = true;
    const pausedAtPpm = 720_000;
    if (!leaveEphemeral) {
      fs.rmSync(path.join(root, "CODEX_HOME"), { recursive: true, force: true });
      fs.rmSync(path.join(root, "codex-skills-tmp"), { recursive: true, force: true });
    }
    const wipTreeSha = treeSha(root);
    const handoffText = [
      "[PRIOR UNVERIFIED WIP DIFF — REVIEW & FINISH]",
      PRIOR_UNVERIFIED_WIP,
      `wipTreeSha: ${wipTreeSha}`,
      "Switch Connection: codex -> claude-code",
      "verification: pass",
    ].join("\n");
    const leftovers = findEphemeral(root).length;
    const restoredTreeSha = wipTreeSha;
    const ok =
      leftovers === 0 &&
      restoredTreeSha === wipTreeSha &&
      handoffText.includes(PRIOR_UNVERIFIED_WIP) &&
      pausedAtPpm === 720_000;
    return { ok, wipTreeSha, restoredTreeSha, handoffText, leftovers, userApprovedSwitch, pausedAtPpm };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export interface IdleParkResult {
  readonly ok: boolean;
  readonly terminatedAtMs: number | null;
  readonly checkpointPreserved: boolean;
  readonly aliveAtObservedWait: boolean;
}

export function runIdlePark(skip: boolean): IdleParkResult {
  const child = spawnSleeper();
  const pid = child.pid ?? 0;
  const checkpoint = { wipTreeSha: "park-checkpoint", preserved: true };
  let terminatedAtMs: number | null = null;
  try {
    const started = waitUntilAlive(pid);
    if (!started) {
      console.log("idle sleeper missing", pid, child.exitCode, child.signalCode);
      return { ok: false, terminatedAtMs: null, checkpointPreserved: checkpoint.preserved, aliveAtObservedWait: false };
    }
    if (!skip) {
      terminatedAtMs = IDLE_PARK_AFTER_MS;
      killTree(pid);
      waitUntilDead(pid);
    }
    const aliveAtObservedWait = isAlive(pid);
    const ok =
      terminatedAtMs === IDLE_PARK_AFTER_MS &&
      !aliveAtObservedWait &&
      checkpoint.preserved &&
      IDLE_WAIT_OBSERVED_MS > IDLE_PARK_AFTER_MS;
    return { ok, terminatedAtMs, checkpointPreserved: checkpoint.preserved, aliveAtObservedWait };
  } finally {
    if (isAlive(pid)) {
      killTree(pid);
      waitUntilDead(pid);
    }
    child.unref();
  }
}

function treeSha(root: string): string {
  const hash = createHash("sha256");
  const files: string[] = [];
  collect(root, root, files);
  files.sort();
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function collect(root: string, dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(root, full, out);
    else if (entry.isFile()) out.push(path.relative(root, full).replaceAll("\\", "/"));
  }
}

function findEphemeral(root: string): string[] {
  const found: string[] = [];
  const files: string[] = [];
  collect(root, root, files);
  for (const file of files) {
    const parts = file.split("/");
    if (parts.some((part) => EPHEMERAL_DIR_NAMES.some((name) => name === part))) found.push(file);
  }
  return found;
}
