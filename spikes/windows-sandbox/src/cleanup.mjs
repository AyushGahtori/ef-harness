import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SCRATCH_PREFIX = "ef-harness-task-003-";

export function makeScratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
}

export function removeTree(target) {
  if (!target) return;
  fs.rmSync(target, { recursive: true, force: true });
}

export function sweepLeftovers() {
  const root = os.tmpdir();
  const removed = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith(SCRATCH_PREFIX)) continue;
    const full = path.join(root, name);
    fs.rmSync(full, { recursive: true, force: true });
    removed.push(full);
  }
  return removed;
}

export function leftoverNames() {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(SCRATCH_PREFIX));
}

/**
 * @param {number} pid
 */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

/**
 * @param {number} pid
 */
export function stopPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid);
  } catch (error) {
    if (!error || error.code !== "ESRCH") return;
  }
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {number[]} pids
 * @param {number} budgetMs
 */
export async function waitUntilDead(pids, budgetMs) {
  const started = Date.now();
  let alive = pids.filter((pid) => isPidAlive(pid));
  while (alive.length > 0 && Date.now() - started < budgetMs) {
    await sleep(25);
    alive = pids.filter((pid) => isPidAlive(pid));
  }
  return { elapsedMs: Date.now() - started, alive };
}
