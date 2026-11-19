import fs from "node:fs";
import path from "node:path";
import { spawnCaptured } from "./spawn.mjs";

/**
 * @param {string} directory
 * @param {number} fileCount
 */
function plantFiles(directory, fileCount) {
  fs.mkdirSync(directory, { recursive: true });
  for (let index = 0; index < fileCount; index += 1) {
    fs.writeFileSync(path.join(directory, `file-${index}.txt`), "x");
  }
}

/**
 * @param {string} scratch
 * @param {number} fileCount
 * @param {() => Promise<Record<string, unknown>>} sample
 */
export async function measureAcl(scratch, fileCount, sample) {
  const who = await spawnCaptured("whoami.exe", [], { timeoutMs: 5000 });
  const user = who.stdout.trim();
  const emptyDir = path.join(scratch, "acl-empty");
  const fullDir = path.join(scratch, "acl-full");
  fs.mkdirSync(emptyDir, { recursive: true });
  plantFiles(fullDir, fileCount);
  const emptyStarted = performance.now();
  const emptyGrant = await spawnCaptured(
    "icacls.exe",
    [emptyDir, "/grant:r", `${user}:(OI)(CI)M`, "/C"],
    { timeoutMs: 20000 },
  );
  const emptyMs = performance.now() - emptyStarted;
  const emptyDisk = await sample();
  const fullStarted = performance.now();
  const fullGrant = await spawnCaptured(
    "icacls.exe",
    [fullDir, "/grant:r", `${user}:(OI)(CI)M`, "/T", "/C"],
    { timeoutMs: 120000 },
  );
  const fullMs = performance.now() - fullStarted;
  const fullDisk = await sample();
  return {
    user,
    fileCount,
    empty: {
      ms: emptyMs,
      code: emptyGrant.code,
      diskQueueLength: Number(emptyDisk.diskQueueLength ?? 0),
      diskActivePercent: Number(emptyDisk.diskActivePercent ?? 0),
    },
    afterTree: {
      ms: fullMs,
      code: fullGrant.code,
      diskQueueLength: Number(fullDisk.diskQueueLength ?? 0),
      diskActivePercent: Number(fullDisk.diskActivePercent ?? 0),
    },
  };
}
