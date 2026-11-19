import fs from "node:fs";
import path from "node:path";
import { spawnCaptured } from "./spawn.mjs";

const identity = ["-c", "user.name=EF Capacity", "-c", "user.email=capacity@example.invalid"];

/**
 * @param {string} dir
 * @param {readonly string[]} args
 */
function git(dir, args) {
  return spawnCaptured("git", ["-C", dir, ...args], { timeoutMs: 20000 });
}

/**
 * Cold create versus reuse (`git checkout` + clean) on one scratch slot.
 * @param {string} scratch
 */
export async function measureSlotReset(scratch) {
  const slot = path.join(scratch, "git-slot");
  fs.mkdirSync(slot, { recursive: true });
  const coldStarted = performance.now();
  await git(slot, ["init", "-q"]);
  fs.writeFileSync(path.join(slot, "readme.txt"), "slot\n");
  await git(slot, ["add", "readme.txt"]);
  const committed = await git(slot, [...identity, "commit", "-q", "-m", "slot"]);
  const coldCreateMs = performance.now() - coldStarted;
  fs.writeFileSync(path.join(slot, "readme.txt"), "dirty\n");
  fs.writeFileSync(path.join(slot, "junk.txt"), "junk\n");
  const reuseStarted = performance.now();
  const checkout = await git(slot, ["checkout", "--", "."]);
  const clean = await git(slot, ["clean", "-fd"]);
  const reuseResetMs = performance.now() - reuseStarted;
  return {
    coldCreateMs,
    reuseResetMs,
    commitCode: committed.code,
    checkoutCode: checkout.code,
    cleanCode: clean.code,
    readme: fs.readFileSync(path.join(slot, "readme.txt"), "utf8").trim(),
    junkRemains: fs.existsSync(path.join(slot, "junk.txt")),
  };
}
