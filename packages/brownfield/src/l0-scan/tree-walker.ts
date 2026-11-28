import fs from "node:fs";
import path from "node:path";
import type { MinGitRepoInspectorPort } from "./git-exec.js";
import { languageForPath, shouldSkipPath } from "./language.js";
import { isSensitivePath } from "./sensitive.js";
import type { ScannedFile, SensitivePathMeta } from "./types.js";

const TEXT_PROBE_BYTES = 8192;

function isBinaryFile(fullPath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(fullPath, "r");
    const buf = Buffer.alloc(Math.min(TEXT_PROBE_BYTES, fs.fstatSync(fd).size || TEXT_PROBE_BYTES));
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    for (let i = 0; i < read; i += 1) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function walkUntrackedNonGit(
  root: string,
  relDir: string,
  out: string[],
  visitedInodes: Set<string>,
): void {
  const fullDir = path.join(root, relDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(fullDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (shouldSkipPath(rel)) continue;
    const full = path.join(root, rel);
  if (entry.isSymbolicLink()) {
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      const key = `${stat.dev}:${stat.ino}`;
      if (visitedInodes.has(key)) continue;
      visitedInodes.add(key);
      let target: fs.Stats;
      try {
        target = fs.statSync(full);
      } catch {
        continue;
      }
      if (target.isDirectory()) {
        walkUntrackedNonGit(root, rel, out, visitedInodes);
      } else if (target.isFile()) {
        out.push(rel.replaceAll("\\", "/"));
      }
      continue;
    }
    if (entry.isDirectory()) {
      walkUntrackedNonGit(root, rel, out, visitedInodes);
    } else if (entry.isFile()) {
      out.push(rel.replaceAll("\\", "/"));
    }
  }
}

export interface TreeWalkResult {
  readonly files: readonly ScannedFile[];
  readonly sensitiveSkipped: readonly SensitivePathMeta[];
}

export function listRepoFiles(root: string, git: MinGitRepoInspectorPort, isGit: boolean): TreeWalkResult {
  const relPaths = new Set<string>();
  const sensitiveSkipped: SensitivePathMeta[] = [];

  if (isGit) {
    for (const p of git.lsFiles(root)) {
      if (!shouldSkipPath(p)) relPaths.add(p);
    }
    for (const p of git.lsOthers(root)) {
      if (!shouldSkipPath(p)) relPaths.add(p);
    }
  } else {
    const discovered: string[] = [];
    walkUntrackedNonGit(root, "", discovered, new Set());
    for (const p of discovered) relPaths.add(p);
  }

  const files: ScannedFile[] = [];
  for (const rel of [...relPaths].sort()) {
    if (isSensitivePath(rel)) {
      sensitiveSkipped.push({ path: rel, ignoredByGit: false, skippedAsSensitive: true });
      continue;
    }
    const full = path.join(root, rel);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const ext = path.extname(rel).toLowerCase();
    const binary = isBinaryFile(full);
    files.push({
      path: rel,
      bytes: stat.size,
      extension: ext,
      language: languageForPath(rel),
      tracked: isGit,
      isBinary: binary,
    });
  }

  return { files, sensitiveSkipped };
}